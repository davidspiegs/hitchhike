/** Clarification budgets and schedule reservations against migrated SQLite.
 * No running server, external requests, credentials, or production resources. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-workflow-test-'));
const sqlite = new DatabaseSync(':memory:');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Workflow tests must not use the network'); };
const now = 1_800_000_000_000;
const owner = { owner: true, agent: null };
let checks = 0;
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() { return { meta: sqlite.prepare(this.sql).run(...this.values), success: true }; }
}
const DB = {
  prepare: sql => new Statement(sql),
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const result = statements.map(s => {
        const stmt = sqlite.prepare(s.sql);
        if (stmt.columns().length) return { results: stmt.all(...s.values), meta: sqlite.prepare('SELECT changes() changes').get(), success: true };
        return { results: [], meta: stmt.run(...s.values), success: true };
      });
      sqlite.exec('COMMIT'); return result;
    } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  },
};
const env = { DB, HOSTED: 'true', MIN_LEASE_SECONDS: '1' };
const check = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const row = id => sqlite.prepare('SELECT * FROM jobs WHERE id=?').get(id);
const scheduleRow = () => sqlite.prepare("SELECT * FROM schedules WHERE id='routine'").get();
const eventCount = kind => sqlite.prepare('SELECT COUNT(*) n FROM events WHERE kind=?').get(kind).n;
const worker = id => sqlite.prepare('SELECT * FROM agents WHERE id=?').get(id);
function reset() {
  for (const table of ['claims', 'events', 'schedules', 'jobs', 'agents']) sqlite.exec(`DELETE FROM ${table}`);
  sqlite.exec("UPDATE workspaces SET paused=0,daily_job_limit=500,monthly_job_limit=10000 WHERE id='default'");
  addWorker('worker');
}
function addWorker(id) {
  sqlite.prepare(`INSERT INTO agents(id,handle,name,token_hash,can_work,can_request,work_types,created_at)
    VALUES (?,?,?,?,1,0,'["task"]',?)`).run(id, id, id, 'synthetic-' + id, now);
}
try {
  for (const file of (await readdir(join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(root, 'migrations', file), 'utf8'));
  const modulePath = join(temporary, 'workflow.mjs');
  await build({ stdin: { contents: "export * from './src/store';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: modulePath, logLevel: 'silent' });
  const api = await import(pathToFileURL(modulePath).href);
  const create = async (max_attempts = 1, to = 'worker') => (await api.createJob(env, 'owner', null,
    { type: 'task', to, title: 'Workflow fixture', goal: 'Complete the fixture.', max_attempts, lease_seconds: 1 }, undefined, now)).row;
  const claim = (at, id = 'worker') => api.claimNext(env, worker(id), at);
  const ask = (token, at) => api.submitResult(env, token, { status: 'needs_input', question: 'Which option?' }, [], at);
  const complete = (token, at) => api.submitResult(env, token, { summary: 'Fixture completed.' }, [], at);
  const saveSchedule = (at = now, settings = {}) => api.upsertSchedule(env, { id: 'routine', every_minutes: 5,
    template: { type: 'task', to: 'worker', title: 'Scheduled fixture', goal: 'Complete.' }, ...settings }, at);

  await check('a final-attempt question is answerable and old same-timestamp claims stay fenced', async () => {
    reset(); const job = await create(); const first = await claim(now);
    assert.equal((await ask(first.token, now)).kind, 'question_sent');
    assert.equal((await api.transition(env, owner, job.id, 'reply', 'Use option A.', now)).clarification_rounds, 1);
    const resumed = await claim(now);
    assert.equal(resumed.job.attempts, 2); assert.equal(resumed.job.clarification_rounds, 1);
    assert.equal((await ask(first.token, now)).kind, 'stale');
    assert.equal(await api.heartbeat(env, first.token, now), null);
    assert.equal((await complete(first.token, now)).kind, 'stale');
    assert.equal((await complete(resumed.token, now)).kind, 'accepted');
  });
  await check('clarifications are bounded and duplicate questions/replies never grant extra credits', async () => {
    reset(); const job = await create(); let held = await claim(now);
    for (let round = 0; round < 5; round++) {
      const at = now + round * 10;
      assert.equal((await ask(held.token, at)).kind, 'question_sent');
      assert.equal((await ask(held.token, at)).kind, 'stale');
      const answers = await Promise.allSettled([
        api.transition(env, owner, job.id, 'reply', 'Answer.', at),
        api.transition(env, owner, job.id, 'reply', 'Duplicate.', at),
      ]);
      assert.equal(answers.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(row(job.id).clarification_rounds, round + 1);
      held = await claim(at);
      assert.equal(held.job.attempts, round + 2);
    }
    await assert.rejects(ask(held.token, now + 50), e => e.code === 'clarification_limit' && e.status === 409);
    assert.equal(row(job.id).status, 'claimed'); assert.equal(row(job.id).clarification_rounds, 5);
    assert.equal((await complete(held.token, now + 50)).kind, 'accepted');
  });
  await check('lost leases still exhaust work attempts after a clarification credit', async () => {
    reset(); const job = await create(2); const first = await claim(now);
    await ask(first.token, now); await api.transition(env, owner, job.id, 'reply', 'Answer.', now);
    const resumed = await claim(now);
    await api.sweep(env, now + 1001); assert.equal(row(job.id).status, 'queued');
    const retry = await claim(now + 1001); assert.equal(retry.job.attempts, 3);
    assert.equal((await ask(resumed.token, now + 1001)).kind, 'stale');
    await api.sweep(env, now + 2002); assert.equal(row(job.id).status, 'failed');
    assert.equal((await claim(now + 2002)).job, null);
  });
  await check('feedback and broadcast worker deletion use the effective work budget', async () => {
    reset(); const job = await create(2); const first = await claim(now);
    await ask(first.token, now); await api.transition(env, owner, job.id, 'reply', 'Answer.', now);
    const resumed = await claim(now); await complete(resumed.token, now);
    await api.transition(env, owner, job.id, 'reject', 'Revise.', now);
    const revision = await claim(now); await complete(revision.token, now);
    await assert.rejects(api.transition(env, owner, job.id, 'reject', 'Revise again.', now), e => e.status === 409);
    reset(); const broadcast = await create(2, '*'); const before = await claim(now);
    await ask(before.token, now); await api.transition(env, owner, broadcast.id, 'reply', 'Answer.', now);
    await claim(now); addWorker('second-worker'); await api.deleteAgent(env, 'worker', now);
    assert.equal(row(broadcast.id).status, 'queued');
    const after = await claim(now, 'second-worker'); assert.equal(after.job.attempts, 3);
    await api.deleteAgent(env, 'second-worker', now); assert.equal(row(broadcast.id).status, 'failed');
  });
  await check('same-tick schedule invocations reserve one occurrence with one task', async () => {
    reset(); await saveSchedule();
    const results = await Promise.all([api.runSchedules(env, now, 1), api.runSchedules(env, now, 1)]);
    assert.equal(results.flat().length, 1); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n, 1);
    assert.equal(scheduleRow().attempt_token, null); assert.equal(scheduleRow().next_attempt_at, now + 300_000);
  });
  await check('persistent routing failures back off, retain their slot, and disable after three without event flood', async () => {
    reset(); await saveSchedule(); sqlite.exec("UPDATE agents SET work_types='[]'");
    await api.runSchedules(env, now, 1);
    assert.equal(scheduleRow().next_attempt_at, now + 300_000);
    await api.runSchedules(env, now + 1, 1); assert.equal(scheduleRow().consecutive_failures, 1);
    await api.runSchedules(env, now + 300_000, 1);
    assert.equal(scheduleRow().next_attempt_at, now + 900_000); assert.equal(eventCount('schedule_failed'), 1);
    await api.runSchedules(env, now + 900_000, 1);
    assert.equal(scheduleRow().enabled, 0); assert.equal(scheduleRow().consecutive_failures, 3);
    assert.equal(scheduleRow().next_run_at, now); assert.ok(scheduleRow().disabled_reason);
    assert.equal(eventCount('schedule_disabled'), 1); assert.equal(eventCount('schedule_failed'), 1);
    sqlite.exec("UPDATE agents SET work_types='[\"task\"]'"); await saveSchedule(now + 1_000_000);
    assert.equal(scheduleRow().enabled, 1); assert.equal(scheduleRow().consecutive_failures, 0);
    assert.equal(scheduleRow().last_error, null); assert.equal(scheduleRow().disabled_reason, null);
  });
  await check('quotas remain retryable with capped exponential delay and emit a single recovery', async () => {
    reset(); await saveSchedule(); sqlite.exec('UPDATE workspaces SET daily_job_limit=0');
    let at = now;
    for (const delay of [300_000, 600_000, 1_200_000, 2_400_000, 3_600_000, 3_600_000]) {
      await api.runSchedules(env, at, 1);
      assert.equal(scheduleRow().next_attempt_at, at + delay); assert.equal(scheduleRow().enabled, 1);
      at += delay;
    }
    assert.equal(eventCount('schedule_failed'), 1); assert.equal(scheduleRow().consecutive_permanent_failures, 0);
    sqlite.exec('UPDATE workspaces SET daily_job_limit=500');
    assert.equal((await api.runSchedules(env, at, 1)).length, 1);
    assert.equal(eventCount('schedule_recovered'), 1); assert.equal(scheduleRow().consecutive_failures, 0);
    assert.equal(sqlite.prepare('SELECT idempotency_key FROM jobs').get().idempotency_key, `schedule:routine:${now}`);
    assert.equal(scheduleRow().next_run_at, at + 300_000);
  });
  await check('a crash after creation retains the reservation and retries the same occurrence idempotently', async () => {
    reset(); await saveSchedule();
    const crashing = { ...env, DB: { ...DB, async batch(statements) {
      if (statements[0].sql.startsWith('UPDATE schedules SET next_run_at') || statements[0].sql.startsWith('UPDATE schedules SET next_attempt_at')) throw new Error('Simulated process crash');
      return DB.batch(statements);
    } } };
    await assert.rejects(api.runSchedules(crashing, now, 1), /Simulated process crash/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n, 1);
    assert.equal(scheduleRow().next_run_at, now); assert.equal(scheduleRow().next_attempt_at, now + 300_000);
    assert.equal((await api.runSchedules(env, now + 1, 1)).length, 0);
    assert.equal((await api.runSchedules(env, now + 300_000, 1)).length, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n, 1);
  });
  await check('owner schedule edits fence a stale completion even when they keep the same occurrence time', async () => {
    reset(); await saveSchedule(); let edit = true;
    const editing = { ...env, DB: { ...DB, async batch(statements) {
      if (edit && statements[0].sql.startsWith('UPDATE schedules SET next_run_at')) {
        edit = false; await saveSchedule(now, { every_minutes: 60 });
      }
      return DB.batch(statements);
    } } };
    assert.equal((await api.runSchedules(editing, now, 1)).length, 0);
    assert.equal(scheduleRow().every_minutes, 60); assert.equal(scheduleRow().next_run_at, now);
    assert.equal(scheduleRow().attempt_token, null); assert.equal(scheduleRow().last_job_id, null);
    assert.equal(eventCount('schedule_recovered'), 0);
  });
  await check('an owner edit between discovery and reservation prevents work from the stale template', async () => {
    reset(); await saveSchedule(); let edit = true;
    const editing = { ...env, DB: { ...DB, prepare(sql) {
      const statement = DB.prepare(sql);
      if (!sql.startsWith('SELECT * FROM schedules WHERE')) return statement;
      return { bind(...values) { const bound = statement.bind(...values); return { async all() {
        const result = await bound.all();
        if (edit) { edit = false; await saveSchedule(now, { every_minutes: 60 }); }
        return result;
      } }; } };
    } } };
    assert.equal((await api.runSchedules(editing, now, 1)).length, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n, 0);
    assert.equal(scheduleRow().every_minutes, 60); assert.equal(scheduleRow().last_attempt_at, 0);
  });
  console.log(`\n${checks} workflow regressions passed; no network used.`);
} finally {
  globalThis.fetch = originalFetch; sqlite.close(); await rm(temporary, { recursive: true, force: true });
}
