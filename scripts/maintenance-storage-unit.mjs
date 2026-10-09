/** Cleanup must remain possible when metadata storage is full. No provider I/O. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'relay-maintenance-storage-'));
const now = 1_800_000_000_000, DAY = 86400000;
const originalFetch = globalThis.fetch, databases = [];
globalThis.fetch = async () => { throw new Error('Maintenance storage tests prohibit provider calls'); };
let passed = 0, failed = 0;
async function check(name, test) {
  try { await test(); console.log(`ok ${++passed} - ${name}`); }
  catch (error) { failed++; console.error(`not ok - ${name}\n${error.stack ?? error}`); }
}
try {
  const bundle = join(temporary, 'maintenance-storage.mjs');
  await build({ stdin: { contents: "export {sweep,runSchedules,maintenance} from './src/store'; export {admitResourceOperation} from './src/budgets';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const api = await import(pathToFileURL(bundle).href);
  const migrations = await Promise.all((await readdir(join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort().map(name => readFile(join(root, 'migrations', name), 'utf8')));
  async function fixture() {
    const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
    for (const migration of migrations) sqlite.exec(migration);
    const state = { beforeExecute: null };
    class Statement {
      constructor(sql, values = []) { this.sql = sql; this.values = values; }
      bind(...values) { return new Statement(this.sql, values); }
      query() { state.beforeExecute?.(this.sql, this.values); return sqlite.prepare(this.sql); }
      async first() { return this.query().get(...this.values) ?? null; }
      async all() { return { results: this.query().all(...this.values), success: true }; }
      async run() {
        const query = this.query();
        return query.columns().length ? { results: query.all(...this.values), meta: sqlite.prepare('SELECT changes() changes').get(), success: true }
          : { results: [], meta: query.run(...this.values), success: true };
      }
    }
    const DB = { prepare: sql => new Statement(sql), async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    sqlite.prepare('INSERT INTO workspaces(id,name,created_at,retention_days) VALUES (?,?,?,1)').run('cleanup', 'Cleanup fixture', now);
    const env = { DB, HOSTED: 'true', WORKSPACE_ID: 'cleanup' };
    assert.equal((await api.admitResourceOperation(env, 'cleanup', 'new_work', now)).allowed, true);
    const get = (sql, ...values) => sqlite.prepare(sql).get(...values);
    const run = (sql, ...values) => sqlite.prepare(sql).run(...values);
    const count = (table, where = '1=1') => get(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).n;
    const usage = () => get("SELECT accounted_bytes n FROM workspace_storage_usage WHERE workspace_id='cleanup'").n;
    function job(id, extras = {}) {
      const row = { id, workspace_id:'cleanup', v:'1', type:'task', from_agent:'owner', to_agent:'worker', title:'Fixture', spec:'{"goal":"Fixture"}', status:'queued', lease_seconds:300, created_at:now, updated_at:now, ...extras };
      run(`INSERT INTO jobs(${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, ...Object.values(row));
    }
    function leaseBacklog() {
      for (let i = 0; i < 2; i++) {
        job(`retry-${i}`, { status:'claimed', lease_holder:'worker', lease_id:`retry-lease-${i}`, lease_expires_at:now-1, attempts:1, max_attempts:2 });
        job(`final-${i}`, { status:'claimed', lease_holder:'worker', lease_id:`final-lease-${i}`, lease_expires_at:now-1, attempts:1, max_attempts:1 });
        job(`expire-${i}`, { expires_at:now-1 });
      }
    }
    function schedule(extras = {}) {
      const row = { id:'due', workspace_id:'cleanup', every_minutes:5, template:JSON.stringify({from:'owner',request:{type:'task',to:'missing-worker',title:'Broken schedule',goal:'Fixture'}}), next_run_at:now-1, next_attempt_at:now-1, created_at:now, ...extras };
      run(`INSERT INTO schedules(${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, ...Object.values(row));
    }
    function history() {
      job('matured-history', { status:'completed', spec:JSON.stringify({goal:'M'.repeat(32768)}), created_at:now-40*DAY, updated_at:now-40*DAY, completed_at:now-40*DAY });
      run("INSERT INTO events(workspace_id,ts,actor,kind) VALUES ('cleanup',?,'relay','old-event')", now-40*DAY);
      run("INSERT INTO claims(token_hash,workspace_id,job_id,agent_id,attempt,issued_at,expires_at) VALUES ('old-claim','cleanup','matured-history','worker',1,?,?)", now-40*DAY, now-39*DAY);
    }
    function capacity(mode) {
      if (['full','over','partial-group'].includes(mode)) run("UPDATE workspaces SET storage_limit_bytes=? WHERE id='cleanup'", usage() + (mode==='over' ? -16384 : mode==='partial-group' ? 7000 : 0));
      if (mode === 'shared-over') {
        run("INSERT INTO workspaces(id,name,created_at) VALUES ('shared-padding','Shared padding',?)", now);
        const total = get("SELECT SUM(accounted_bytes) n FROM workspace_storage_usage WHERE workspace_id<>'default'").n;
        run("UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes+? WHERE workspace_id='shared-padding'", 1610612736+16384-total);
      }
    }
    return { sqlite, state, env, get, run, count, usage, job, leaseBacklog, schedule, history, capacity };
  }
  function swept(f) {
    assert.equal(f.count('jobs', "id LIKE 'retry-%' AND status='queued'"), 2);
    assert.equal(f.count('jobs', "id LIKE 'final-%' AND status='failed'"), 2);
    assert.equal(f.count('jobs', "id LIKE 'expire-%' AND status='expired'"), 2);
    assert.equal(f.count('jobs', 'lease_holder IS NOT NULL OR lease_id IS NOT NULL'), 0);
  }
  for (const mode of ['available','full','over','partial-group','shared-over']) await check(`sweep transitions all bounded rows with ${mode} storage`, async () => {
    const f = await fixture(); f.leaseBacklog(); f.capacity(mode);
    assert.equal((await api.sweep(f.env, now, 2)).length, 2); swept(f);
    assert.equal(f.count('events'), mode==='available' ? 6 : 0, 'Audit groups are admitted whole or omitted without blocking the transitions');
  });
  for (const mode of ['available','full','over','shared-over']) await check(`schedule backoff and disable persist with ${mode} storage`, async () => {
    const f = await fixture(); f.schedule(); f.capacity(mode);
    for (const at of [now,now+300000,now+900000]) assert.deepEqual(await api.runSchedules(f.env, at, 1), []);
    const row = f.get("SELECT * FROM schedules WHERE id='due'");
    assert.equal(row.enabled, 0); assert.equal(row.consecutive_failures, 3); assert.equal(row.consecutive_permanent_failures, 3);
    assert.equal(row.attempt_token, null); assert.match(row.disabled_reason, /unknown_worker/);
    assert.equal(f.count('events'), mode==='available' ? 2 : 0);
  });
  for (const mode of ['available','full','over','shared-over']) await check(`recovered schedule advances its existing idempotent job with ${mode} storage`, async () => {
    const f = await fixture(); f.job('prior-job', {idempotency_key:`schedule:due:${now-1}`});
    f.schedule({consecutive_failures:1,last_job_id:'prior-job',last_error:'Transient failure'}); f.capacity(mode);
    assert.equal((await api.runSchedules(f.env, now, 1)).length, 1);
    const row = f.get("SELECT * FROM schedules WHERE id='due'");
    assert.ok(row.next_run_at>now); assert.equal(row.consecutive_failures,0); assert.equal(row.last_error,null); assert.equal(row.attempt_token,null);
    assert.equal(f.count('events', "kind='schedule_recovered'"), mode==='available' ? 1 : 0);
  });
  for (const encoding of ['multibyte','json-escaped']) await check(`schedule failure metadata stays bounded for ${encoding} errors`, async () => {
    const f = await fixture(), to = encoding==='multibyte' ? '🐕'.repeat(300) : 'missing'+'\u0000'.repeat(600);
    f.schedule({template:JSON.stringify({from:'owner',request:{type:'task',to,title:'Broken schedule',goal:'Fixture'}})});
    f.capacity('full');
    if (encoding==='json-escaped') f.run("UPDATE workspaces SET storage_limit_bytes=storage_limit_bytes+5000 WHERE id='cleanup'");
    assert.deepEqual(await api.runSchedules(f.env, now, 1), []);
    const row = f.get("SELECT last_error,consecutive_failures,attempt_token FROM schedules WHERE id='due'");
    assert.equal(row.consecutive_failures,1); assert.equal(row.attempt_token,null);
    assert.ok(new TextEncoder().encode(row.last_error).length<=512); assert.equal(f.count('events'),0);
  });
  for (const mode of ['full','over']) await check(`maintenance prunes matured history before lease and schedule work with ${mode} storage`, async () => {
    const f = await fixture(); f.leaseBacklog(); f.schedule(); f.history(); f.capacity(mode);
    const result = await api.maintenance(f.env, 'https://fixture.invalid', now, {sweepLimit:2,scheduleLimit:1});
    assert.equal(result.requeued.length, 2); swept(f);
    assert.equal(f.count('jobs', "id='matured-history'"), 0); assert.equal(f.count('events', "kind='old-event'"), 0); assert.equal(f.count('claims', "token_hash='old-claim'"), 0);
    assert.equal(f.get("SELECT consecutive_failures n FROM schedules WHERE id='due'").n, 1);
  });
  for (const stage of ['sweep','schedule']) await check(`retention still completes when ${stage} encounters an unrelated database failure`, async () => {
    const f = await fixture(); f.leaseBacklog(); f.schedule(); f.history();
    f.state.beforeExecute = sql => {
      if (stage==='sweep' ? /UPDATE jobs SET status='queued'/.test(sql) : /SELECT \* FROM schedules/.test(sql)) throw new Error('Synthetic unrelated database failure');
    };
    await assert.rejects(api.maintenance(f.env, 'https://fixture.invalid', now), /Synthetic unrelated database failure/);
    assert.equal(f.count('jobs', "id='matured-history'"), 0); assert.equal(f.count('events', "kind='old-event'"), 0); assert.equal(f.count('claims', "token_hash='old-claim'"), 0);
  });
  console.log(`\n${passed} maintenance storage checks passed; ${failed} failed.`);
  if (failed) process.exitCode = 1;
} finally { globalThis.fetch = originalFetch; for (const database of databases) database.close(); await rm(temporary, {recursive:true,force:true}); }
