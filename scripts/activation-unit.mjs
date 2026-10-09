#!/usr/bin/env node
/** No live provider calls: migrated SQLite plus injected transport only. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'hitchhike-activation-'));
const sqlite = new DatabaseSync(':memory:');
let afterFirst;
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { const row = sqlite.prepare(this.sql).get(...this.values) ?? null; if (afterFirst) await afterFirst(this.sql, row); return row; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() { return { meta: sqlite.prepare(this.sql).run(...this.values), success: true }; }
}
const DB = {
  prepare: sql => new Statement(sql),
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const now = 1_800_000_000_000;
const env = { DB, WORKSPACE_ID: 'default', HOSTED: 'true', HOSTED_ACTIVATION_ENABLED: 'true', ENCRYPTION_KEY: 'synthetic-activation-key-only' };
const owner = { owner: true, agent: null };
const endpoint = 'https://api.anthropic.com/v1/claude_code/routines/trig_synthetic12345/fire';
const token = 'sk-ant-oat01-SYNTHETIC_TOKEN_NOT_A_REAL_CREDENTIAL';
const origin = 'https://hitchhike.test';
const response = () => Response.json({ type: 'routine_fire', claude_code_session_id: 'session_synthetic', claude_code_session_url: 'https://claude.ai/code/session_synthetic' });
const latest = () => sqlite.prepare('SELECT * FROM activation_dispatches ORDER BY rowid DESC LIMIT 1').get();
let forbiddenCalls = 0;
const forbid = async () => { forbiddenCalls++; throw new Error('Unexpected network: this function must not be called'); };
let checks = 0;
const check = async (name, fn) => { await fn(); assert.equal(forbiddenCalls, 0, 'Unexpected provider call'); console.log(`ok ${++checks} - ${name}`); };
let activation;
async function fixture() {
  sqlite.exec(`DELETE FROM conversation_receipts; DELETE FROM conversation_messages; DELETE FROM conversations; DELETE FROM conversation_chains;
    DELETE FROM agent_collaboration; DELETE FROM agent_onboarding; DELETE FROM collaboration_background_runs;
    DELETE FROM events; DELETE FROM jobs; DELETE FROM agents; DELETE FROM claims; DELETE FROM activation_launch_attempts; DELETE FROM resource_operation_budgets;
    UPDATE workspaces SET paused=0,next_release_beta=1,security_suspended=0,identity_restricted=0,storage_limit_bytes=10485760;
    INSERT OR IGNORE INTO workspaces(id,name,created_at) VALUES ('ws_other','Other',${now});
    INSERT INTO agents(id,workspace_id,handle,name,token_hash,can_work,work_types,created_at)
      VALUES ('worker','default','worker','Claude','workerhash',1,'["research"]',${now});
    INSERT INTO agents(id,workspace_id,handle,name,token_hash,can_request,request_targets,created_at)
      VALUES ('origin','default','origin','Dots shared connection','originhash',1,'["worker"]',${now});
    INSERT INTO agents(id,workspace_id,handle,name,token_hash,can_work,work_types,created_at)
      VALUES ('other','ws_other','other','Other','otherhash',1,'["research"]',${now});
    INSERT INTO jobs(id,workspace_id,v,type,from_agent,to_agent,title,spec,status,lease_seconds,created_at,updated_at)
      VALUES ('request','default','0.1','research','origin','worker','Synthetic','{"goal":"PRIVATE TASK CONTENT"}','queued',300,${now},${now});`);
  await activation.saveActivation(env, owner, 'worker', { endpoint, token, enabled: true }, now);
}
function queued(id, workspace = 'default', worker = 'worker') {
  sqlite.prepare(`INSERT INTO jobs(id,workspace_id,v,type,from_agent,to_agent,title,spec,status,lease_seconds,created_at,updated_at)
    VALUES (?,?,'0.1','research','owner',?,'Synthetic','{}','queued',300,?,?)`).run(id, workspace, worker, now, now);
}
function historicalAdmission(id, workspace = 'default', worker = 'worker', at = now) {
  sqlite.prepare('INSERT OR IGNORE INTO workspaces(id,name,created_at) VALUES (?, ?, ?)').run(workspace, 'Synthetic budget history', at);
  sqlite.prepare(`INSERT INTO activation_launch_attempts(dispatch_id,attempt,reservation_nonce,workspace_id,agent_id,job_id,admitted_at)
    VALUES (?,1,?,?,?,?,?)`).run(id, 'nonce-' + id, workspace, worker, 'job-' + id, at);
}
async function drain(at = now, fetcher = forbid, scoped = env) {
  return activation.dispatchActivations(scoped, origin, at, fetcher);
}
try {
  for (const migration of (await readdir(join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(root, 'migrations', migration), 'utf8'));
  const out = join(temp, 'activation.mjs');
  await build({ entryPoints: [join(root, 'src/activation.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent' });
  activation = await import(pathToFileURL(out).href);

  await check('admission migration preserves legacy attempts conservatively before enabling launch budgets', async () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      for (const migration of (await readdir(join(root, 'migrations'))).filter(f => f.endsWith('.sql') && f < '0016_').sort()) legacy.exec(await readFile(join(root, 'migrations', migration), 'utf8'));
      legacy.prepare(`INSERT INTO activation_dispatches(id,workspace_id,job_id,agent_id,generation,config_revision,status,attempts,next_attempt_at,created_at,updated_at)
        VALUES ('legacy','default','request','worker','0:0',1,'rate_limited',3,?,?,?)`).run(now, now - 60_000, now);
      legacy.exec(await readFile(join(root, 'migrations/0016_activation_admission.sql'), 'utf8'));
      assert.equal(legacy.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 3);
      assert.equal(legacy.prepare('SELECT MIN(admitted_at) at FROM activation_launch_attempts').get().at, now);
      assert.equal(legacy.prepare('SELECT attempts FROM activation_dispatches').get().attempts, 3);
    } finally { legacy.close(); }
  });

  await check('exact provider allowlist rejects alternative hosts, query strings, ports and encoded paths', async () => {
    assert.equal(activation.validateActivationEndpoint(endpoint), null);
    for (const url of [endpoint + '?token=secret', endpoint + '#x', endpoint.replace('https:', 'http:'), endpoint.replace('api.anthropic.com', 'api.anthropic.com.evil.test'), endpoint.replace('api.anthropic.com', 'user:pass@api.anthropic.com'), endpoint.replace('api.anthropic.com', 'api.anthropic.com:443'), endpoint.replace('/fire', '/%66ire'), 'https://127.0.0.1/fire', endpoint.replace('trig_', 'routine_')]) assert.ok(activation.validateActivationEndpoint(url));
  });
  await check('owner-only credentials are encrypted, redacted, disabled by default, and cannot cross tenants', async () => {
    await fixture();
    await assert.rejects(activation.saveActivation(env, { owner: false, agent: null }, 'worker', { endpoint, token }), /Only the workspace owner/);
    await assert.rejects(activation.saveActivation({ ...env, WORKSPACE_ID: 'ws_other' }, owner, 'worker', { endpoint, token }), /No such connection/);
    await assert.rejects(activation.saveActivation({ ...env, ENCRYPTION_KEY: undefined, ADMIN_TOKEN: 'no-hosted-fallback' }, owner, 'worker', { endpoint, token }), /encryption/);
    const metadata = await activation.saveActivation(env, owner, 'worker', { endpoint, token }, now);
    assert.equal(metadata.enabled, false); assert.equal(metadata.background_verified, false);
    assert.ok(!JSON.stringify(metadata).includes(token)); assert.ok(!JSON.stringify(metadata).includes(endpoint)); assert.ok(!JSON.stringify(metadata).includes('ciphertext'));
    assert.match(sqlite.prepare('SELECT token_ciphertext FROM activation_configs').get().token_ciphertext, /^v1:/);
    assert.ok(!sqlite.prepare('SELECT token_ciphertext FROM activation_configs').get().token_ciphertext.includes(token));
    let calls = 0; await drain(now, async () => { calls++; return response(); }); assert.equal(calls, 0);
  });
  await check('launch sends a bounded reference payload with provider headers and retains validated correlation', async () => {
    await fixture(); let calls = 0;
    const totals = await drain(now, async (url, opts) => {
      calls++; assert.equal(url, endpoint); assert.equal(opts.method, 'POST'); assert.equal(opts.redirect, 'manual'); assert.ok(opts.signal);
      assert.equal(opts.headers.Authorization, 'Bearer ' + token); assert.equal(opts.headers['anthropic-version'], '2023-06-01'); assert.equal(opts.headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
      const payload = JSON.parse(JSON.parse(opts.body).text);
      assert.equal(payload.hitchhike_request_id, 'request'); assert.equal(payload.expected_generation, '0:0'); assert.equal(payload.relay_origin, origin);
      assert.ok(!opts.body.includes('PRIVATE TASK CONTENT')); return response();
    });
    assert.equal(calls, 1); assert.equal(totals.launched, 1); assert.equal(latest().provider_session_id, 'session_synthetic');
    await drain(now + 1000); assert.equal(latest().attempts, 1);
  });
  await check('overlapping dispatchers reserve a generation only once', async () => {
    await fixture(); let calls = 0;
    const send = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return response(); };
    await Promise.all([drain(now, send), drain(now, send), drain(now, send)]);
    assert.equal(calls, 1); assert.equal(latest().attempts, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 1);
  });
  await check('hosted execution requires an exact operator opt-in independent of owner settings', async () => {
    for (const enabled of [undefined, 'false', 'TRUE', '1', '']) {
      await fixture(); const blocked = { ...env, HOSTED_ACTIVATION_ENABLED: enabled };
      assert.equal(await activation.activationEligibility(blocked, 'request', now), false);
      await drain(now, forbid, blocked); assert.equal(latest(), undefined);
    }
    await fixture(); await drain(now, response, { ...env, HOSTED: 'false', HOSTED_ACTIVATION_ENABLED: undefined });
    assert.equal(latest().status, 'launched');
  });
  await check('new-work pause and exhausted shared resource allowances stop already queued activations', async () => {
    for (const limits of [{ NEW_WORK_PAUSED: 'true' }, { RESOURCE_GLOBAL_DAILY_OPERATIONS: '0' }, { RESOURCE_GLOBAL_MONTHLY_OPERATIONS: '0' }, { RESOURCE_WORKSPACE_DAILY_OPERATIONS: '0' }]) {
      await fixture(); await drain(now, forbid, { ...env, HOSTED_ACTIVATION_DAILY_LIMIT: '0' });
      sqlite.exec('DELETE FROM resource_operation_budgets');
      assert.equal(latest().status, 'pending');
      await drain(now, forbid, { ...env, ...limits });
      assert.equal(latest().status, 'pending'); assert.equal(latest().attempts, 0);
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 0);
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM resource_operation_budgets').get().n, 0);
    }
    await fixture(); const paused = { ...env, NEW_WORK_PAUSED: 'true' };
    assert.equal(await activation.activationEligibility(paused, 'request', now), false);
    await drain(now, forbid, paused); assert.equal(latest(), undefined);
    await drain(now, response);
    assert.equal(latest().status, 'launched');
    assert.equal(sqlite.prepare("SELECT day_used FROM resource_operation_budgets WHERE scope_type='global'").get().day_used, 10);
    assert.equal(sqlite.prepare("SELECT day_used FROM resource_operation_budgets WHERE scope_type='workspace' AND scope_id='default'").get().day_used, 10);
  });
  await check('zero daily work, occupied single lease, and three queued requests admit zero, zero, and one launches', async () => {
    await fixture(); sqlite.exec("UPDATE agents SET daily_work_limit=0 WHERE id='worker'");
    assert.equal(await activation.activationEligibility(env, 'request', now), false);
    await drain(); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 0);
    await fixture(); queued('held');
    sqlite.prepare("UPDATE jobs SET status='claimed',lease_holder='worker',lease_expires_at=? WHERE id='held'").run(now + 300_000);
    assert.equal(await activation.activationEligibility(env, 'request', now), false); await drain();
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 0);
    await fixture(); queued('request2'); queued('request3'); let calls = 0;
    await drain(now, async () => { calls++; return response(); }); assert.equal(calls, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activation_dispatches WHERE status='launched'").get().n, 1);
  });
  await check('concurrent generations cannot outstrip receiver capacity or consume losing reservations', async () => {
    await fixture(); queued('request2'); queued('request3'); let calls = 0;
    const send = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return response(); };
    await Promise.all([drain(now, send), drain(now, send), drain(now, send)]);
    assert.equal(calls, 1); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 1);
  });
  await check('a blocked oldest request or pending dispatch cannot starve another worker at cron limit one', async () => {
    for (const pending of [false, true]) {
      await fixture();
      if (pending) await drain(now, forbid, { ...env, HOSTED_ACTIVATION_DAILY_LIMIT: '0' });
      sqlite.exec("UPDATE agents SET daily_work_limit=0 WHERE id='worker'");
      sqlite.prepare(`INSERT INTO agents(id,workspace_id,handle,name,token_hash,can_work,work_types,created_at)
        VALUES ('free-worker','default','free-worker','Available','free-worker-hash',1,'["research"]',?)`).run(now);
      await activation.saveActivation(env, owner, 'free-worker', { endpoint, token, enabled: true }, now);
      queued('later-request', 'default', 'free-worker');
      sqlite.prepare("UPDATE jobs SET created_at=? WHERE id='later-request'").run(now + 1);
      let calls = 0;
      await activation.dispatchActivations(env, origin, now + 1, async (_url, options) => {
        calls++; assert.equal(JSON.parse(JSON.parse(options.body).text).hitchhike_request_id, 'later-request'); return response();
      }, { limit: 1 });
      assert.equal(calls, 1);
      assert.equal(sqlite.prepare("SELECT status FROM activation_dispatches WHERE job_id='later-request'").get().status, 'launched');
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 1);
    }
  });
  await check('daily claims and launch reservations count once per job while distinct work consumes allowance', async () => {
    await fixture(); sqlite.exec("UPDATE agents SET max_leases=2,daily_work_limit=2 WHERE id='worker'");
    await drain(now, response);
    sqlite.prepare("UPDATE jobs SET status='claimed',attempts=1,lease_holder='worker',lease_expires_at=? WHERE id='request'").run(now + 300_000);
    sqlite.prepare("INSERT INTO claims(token_hash,workspace_id,job_id,agent_id,attempt,issued_at,expires_at) VALUES ('first','default','request','worker',1,?,?)").run(now, now + 300_000);
    queued('request2'); let calls = 0; await drain(now, async () => { calls++; return response(); }); assert.equal(calls, 1);
    sqlite.exec("UPDATE jobs SET status='completed'"); queued('request3');
    assert.equal(await activation.activationEligibility(env, 'request3', now), false); await drain();
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 2);
  });
  await check('an uncertain launch retains capacity until its request closes and never automatically retries', async () => {
    await fixture(); await drain(now, async () => { throw new Error('ambiguous timeout'); }); queued('request2');
    await drain(); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 1);
    sqlite.exec("UPDATE jobs SET status='canceled' WHERE id='request'"); await drain(now, response);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 2);
  });
  await check('default workspace and global rolling launch caps are ten and fifty, including concurrent dispatchers', async () => {
    await fixture(); sqlite.exec("UPDATE agents SET max_leases=10,daily_work_limit=100 WHERE id='worker'");
    for (let i = 0; i < 9; i++) historicalAdmission('workspace-' + i);
    queued('request2'); let calls = 0; const send = async () => { calls++; return response(); };
    await Promise.all([drain(now, send), drain(now, send)]); assert.equal(calls, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 10);
    await fixture(); sqlite.exec("UPDATE workspaces SET next_release_beta=1 WHERE id='ws_other'");
    await activation.saveActivation({ ...env, WORKSPACE_ID: 'ws_other' }, owner, 'other', { endpoint, token, enabled: true }, now);
    queued('other-request', 'ws_other', 'other');
    for (let i = 0; i < 49; i++) historicalAdmission('global-' + i, 'deleted-workspace', 'deleted-agent');
    sqlite.exec("DELETE FROM workspaces WHERE id='deleted-workspace'");
    calls = 0; await Promise.all([drain(now, send), drain(now, send, { ...env, WORKSPACE_ID: 'ws_other' })]);
    assert.equal(calls, 1); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 50);
  });
  await check('known exhausted launch caps leave pending work without charging operations on repeated ticks', async () => {
    for (const limits of [{ HOSTED_ACTIVATION_WORKSPACE_DAILY_LIMIT: '1' }, { HOSTED_ACTIVATION_DAILY_LIMIT: '1' }]) {
      await fixture(); sqlite.exec("UPDATE agents SET max_leases=3 WHERE id='worker'"); queued('request2'); queued('request3');
      let calls = 0; const scoped = { ...env, ...limits };
      await drain(now, async () => { calls++; return response(); }, scoped); assert.equal(calls, 1);
      for (let tick = 1; tick <= 3; tick++) await drain(now + tick * 60_000, forbid, scoped);
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 1);
      assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activation_dispatches WHERE status='pending' AND attempts=0").get().n, 2);
      for (const row of sqlite.prepare('SELECT day_used,month_used FROM resource_operation_budgets').all()) {
        assert.equal(row.day_used, 10); assert.equal(row.month_used, 10);
      }
    }
  });
  await check('a launch-cap race after the preflight is fenced atomically without refunding attempted operations', async () => {
    await fixture();
    afterFirst = (sql, row) => {
      if (sql.includes('AS launch_available') && row?.launch_available) { afterFirst = undefined; historicalAdmission('race-winner'); }
    };
    try { await drain(now, forbid, { ...env, HOSTED_ACTIVATION_DAILY_LIMIT: '1' }); } finally { afterFirst = undefined; }
    assert.equal(latest().status, 'pending'); assert.equal(latest().attempts, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 1);
    assert.equal(sqlite.prepare("SELECT day_used FROM resource_operation_budgets WHERE scope_type='global'").get().day_used, 10);
  });
  await check('operator limits fail closed and deletion cannot refund an admitted launch', async () => {
    for (const value of ['0', '-1', 'invalid', '1.5']) {
      await fixture(); await drain(now, forbid, { ...env, HOSTED_ACTIVATION_DAILY_LIMIT: value });
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 0);
    }
    await fixture(); const capped = { ...env, HOSTED_ACTIVATION_WORKSPACE_DAILY_LIMIT: '1' };
    await drain(now, response, capped); sqlite.exec("DELETE FROM jobs WHERE id='request'"); queued('request2');
    await drain(now + 1, forbid, capped); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 1);
    await drain(now + 86_400_000, response, capped); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 2);
  });
  await check('suspension and identity restrictions block launches and nonce loss blocks stale I/O', async () => {
    for (const field of ['security_suspended', 'identity_restricted']) {
      await fixture(); sqlite.exec(`UPDATE workspaces SET ${field}=1 WHERE id='default'`);
      assert.equal(await activation.activationEligibility(env, 'request', now), false); await drain(); assert.equal(latest(), undefined);
    }
    await fixture();
    afterFirst = (sql, row) => { if (sql.startsWith('UPDATE activation_dispatches SET status=\'dispatching\'') && row) sqlite.prepare('UPDATE activation_dispatches SET reservation_nonce=? WHERE id=?').run('different-owner', row.id); };
    try { await drain(); } finally { afterFirst = undefined; }
    assert.equal(latest().status, 'dispatching'); assert.equal(latest().provider_session_id, null);
  });
  await check('workspace beta disable and permission changes during reservation stop provider I/O', async () => {
    for (const change of ["UPDATE workspaces SET next_release_beta=0 WHERE id='default'", "UPDATE agents SET can_work=0 WHERE id='worker'", "UPDATE activation_configs SET enabled=0 WHERE agent_id='worker'"]) {
      await fixture();
      afterFirst = (sql, row) => { if (sql.startsWith('UPDATE activation_dispatches SET status=\'dispatching\'') && row) sqlite.exec(change); };
      try { await drain(); } finally { afterFirst = undefined; }
      assert.equal(latest().status, 'canceled'); assert.equal(latest().provider_session_id, null);
    }
  });
  await check('launch evidence cleanup is bounded and keeps the current ninety-day window', async () => {
    await fixture();
    historicalAdmission('old1', 'deleted-workspace', 'deleted-agent', now - 91 * 86_400_000);
    historicalAdmission('old2', 'deleted-workspace', 'deleted-agent', now - 91 * 86_400_000);
    historicalAdmission('recent'); await activation.pruneActivationAttempts(env, now, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 2);
    await activation.pruneActivationAttempts(env, now, 100);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 1);
  });
  await check('storage rejection rolls back both reservation ownership and launch debit before provider I/O', async () => {
    await fixture(); await drain(now, forbid, { ...env, HOSTED_ACTIVATION_DAILY_LIMIT: '0' });
    assert.equal(latest().status, 'pending');
    const usage = sqlite.prepare("SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id='default'").get().accounted_bytes;
    sqlite.prepare("UPDATE workspaces SET storage_limit_bytes=? WHERE id='default'").run(usage);
    await drain(); assert.equal(latest().status, 'pending'); assert.equal(latest().attempts, 0); assert.equal(latest().reservation_nonce, null);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_launch_attempts').get().n, 0);
    assert.equal(sqlite.prepare("SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id='default'").get().accounted_bytes, usage);
  });
  await check('rotation does not bypass request deduplication and revoke removes the local secret', async () => {
    await fixture(); await drain(now, response);
    await activation.saveActivation(env, owner, 'worker', { endpoint, token: token + '_ROTATED', enabled: true }, now + 1);
    await drain(now + 2); assert.equal(latest().attempts, 1);
    const metadata = await activation.revokeActivation(env, owner, 'worker', now + 3);
    assert.equal(metadata.configured, false); assert.equal(metadata.enabled, false);
    assert.equal(sqlite.prepare('SELECT token_ciphertext FROM activation_configs').get().token_ciphertext, null);
    await drain(now + 4);
  });
  await check('definitive 429 uses bounded Retry-After and stops after three attempts', async () => {
    await fixture(); let calls = 0;
    const send = async () => { calls++; return new Response('private failure body', { status: 429, headers: { 'Retry-After': '999999' } }); };
    await drain(now, send); assert.equal(latest().status, 'rate_limited'); assert.equal(latest().next_attempt_at, now + 3_600_000);
    await drain(now + 1); assert.equal(calls, 1);
    await drain(latest().next_attempt_at, send); await drain(latest().next_attempt_at, send);
    assert.equal(calls, 3); assert.equal(latest().status, 'failed'); assert.equal(latest().error_code, 'rate_limit_retry_exhausted');
    assert.ok(!JSON.stringify(latest()).includes('private failure body')); await drain(now + 20_000_000);
  });
  await check('429 HTTP-date and invalid Retry-After values remain bounded', async () => {
    await fixture(); await drain(now, async () => new Response(null, { status: 429, headers: { 'Retry-After': new Date(now + 120_000).toUTCString() } }));
    assert.equal(latest().next_attempt_at, now + 120_000);
    await fixture(); await drain(now, async () => new Response(null, { status: 429, headers: { 'Retry-After': 'bad' } }));
    assert.equal(latest().next_attempt_at, now + 300_000);
  });
  await check('network failures, 5xx and unrecognized successful responses never automatically refire', async () => {
    for (const send of [async () => { throw new Error(token + endpoint); }, async () => new Response(null, { status: 503 }), async () => new Response(null, { status: 500 }), async () => new Response('{}', { status: 200 }), async () => Response.json({ type: 'routine_fire', claude_code_session_id: 'session_synthetic', claude_code_session_url: 'https://evil.test/private' }), async () => new Response(null, { status: 202 })]) {
      await fixture(); await drain(now, send); assert.equal(latest().status, 'uncertain');
      await drain(now + 1_000_000); assert.equal(latest().attempts, 1); assert.ok(!JSON.stringify(latest()).includes(token));
    }
  });
  await check('an interrupted reserved launch becomes uncertain rather than retryable', async () => {
    await fixture(); await drain(now, async () => new Response(null, { status: 429 }));
    sqlite.exec(`UPDATE activation_dispatches SET status='dispatching',reserved_until=${now + 1},error_code=NULL`);
    await drain(now + 1); assert.equal(latest().status, 'uncertain'); assert.equal(latest().error_code, 'interrupted_launch');
    await drain(now + 1_000_000); assert.equal(latest().attempts, 1);
  });
  await check('redirects and definitive client failures are redacted and never followed or retried', async () => {
    for (const status of [302, 400, 401, 403, 404]) {
      await fixture(); await drain(now, async (_url, opts) => { assert.equal(opts.redirect, 'manual'); return new Response('SENSITIVE ERROR', { status, headers: { Location: 'https://evil.test' } }); });
      assert.equal(latest().status, 'failed'); assert.ok(!JSON.stringify(latest()).includes('SENSITIVE ERROR')); await drain(now + 1_000_000);
    }
  });
  await check('changed generation is eligible while nonsemantic updated_at changes do not duplicate launches', async () => {
    await fixture(); await drain(now, response);
    sqlite.exec(`UPDATE jobs SET updated_at=${now + 1}`); await drain(now + 1); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_dispatches').get().n, 1);
    sqlite.exec(`UPDATE jobs SET attempts=1,claims_valid_after=${now + 2}`); await drain(now + 2, response);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_dispatches').get().n, 2);
  });
  await check('queued requests recheck cancellation, expiry, collaborators, categories, and workspace state', async () => {
    for (const change of ["UPDATE jobs SET status='canceled'", `UPDATE jobs SET expires_at=${now}`, "UPDATE jobs SET to_agent='*'", "UPDATE agents SET can_work=0 WHERE id='worker'", "UPDATE agents SET work_types='[]' WHERE id='worker'", "UPDATE agents SET accept_from='[]' WHERE id='worker'", "UPDATE agents SET request_targets='[]' WHERE id='origin'", "UPDATE workspaces SET paused=1 WHERE id='default'"]) {
      await fixture(); sqlite.exec(change); let calls = 0;
      assert.equal(await activation.activationEligibility(env, 'request', now), false);
      await drain(now, async () => { calls++; return response(); }); assert.equal(calls, 0);
    }
    await fixture(); sqlite.exec("UPDATE workspaces SET next_release_beta=0"); let betaCalls = 0; await drain(now, async () => { betaCalls++; return response(); }); assert.equal(betaCalls, 0);
    await fixture(); let calls = 0; await drain(now, async () => { calls++; return response(); }, { ...env, SERVICE_PAUSED: 'true' }); assert.equal(calls, 0);
  });
  await check('collaboration policy and stopped chains prevent provider execution', async () => {
    for (const [agent, settings] of [['worker', {allowed_work_categories: [], permitted_collaborators: ['*']}], ['worker', {allowed_work_categories: ['research'], permitted_collaborators: []}], ['origin', {allowed_request_categories: [], permitted_collaborators: ['*']}]]) {
      await fixture();
      sqlite.prepare('INSERT INTO agent_collaboration(workspace_id,agent_id,settings,updated_at) VALUES (?,?,?,?)').run('default', agent, JSON.stringify(settings), now);
      assert.equal(await activation.activationEligibility(env, 'request', now), false);
      await drain(now); assert.equal(latest().status, 'canceled');
    }
    await fixture(); sqlite.exec(`UPDATE conversation_chains SET stopped_at=${now}`);
    assert.equal(await activation.activationEligibility(env, 'request', now), false); await drain(now); assert.equal(latest(), undefined);
  });
  await check('rate-limited reservations are canceled after a permission change', async () => {
    await fixture(); await drain(now, async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }));
    sqlite.exec("UPDATE agents SET request_targets='[]' WHERE id='origin'"); await drain(now + 60_000);
    assert.equal(latest().status, 'canceled'); assert.equal(latest().attempts, 1);
  });
  await check('ciphertext is bound to the configured endpoint and supports server-key rotation', async () => {
    await fixture(); sqlite.exec("UPDATE activation_configs SET endpoint='https://api.anthropic.com/v1/claude_code/routines/trig_swapped/fire'");
    await drain(now); assert.equal(latest().status, 'failed'); assert.equal(latest().error_code, 'credential_unavailable');
    await fixture(); await drain(now, response, { ...env, ENCRYPTION_KEY: 'new-server-key', ENCRYPTION_KEY_PREVIOUS: env.ENCRYPTION_KEY });
    assert.equal(latest().status, 'launched');
  });
  await check('deleting connections, requests or workspaces destroys associated wake records', async () => {
    await fixture(); await drain(now, response); sqlite.exec("DELETE FROM jobs WHERE id='request'"); assert.equal(latest(), undefined);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_configs').get().n, 1);
    sqlite.exec("DELETE FROM agents WHERE id='worker'"); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_configs').get().n, 0);
    await activation.saveActivation({ ...env, WORKSPACE_ID: 'ws_other' }, owner, 'other', { endpoint, token, enabled: true }, now);
    sqlite.exec("DELETE FROM workspaces WHERE id='ws_other'"); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activation_configs').get().n, 0);
  });
  await check('stage evidence distinguishes relay completion from unattended or Dots-specific verification', async () => {
    await fixture(); await drain(now, response);
    sqlite.exec(`INSERT INTO events(workspace_id,ts,job_id,actor,kind) VALUES ('default',${now + 100},'request','worker','claimed'),('default',${now + 200},'request','worker','completed');
      UPDATE jobs SET status='completed',completed_at=${now + 200},retrieved_at=${now + 300}`);
    const evidence = await activation.getActivationEvidence(env, 'request');
    assert.equal(evidence.relay_round_trip_observed, true); assert.equal(evidence.unattended_verified, false); assert.equal(evidence.destination_session_verified, false);
    assert.equal(evidence.request_created_at, new Date(now).toISOString()); assert.equal(evidence.answered_at, new Date(now + 200).toISOString());
    assert.equal(evidence.origin_retrieved_at, new Date(now + 300).toISOString());
    await assert.rejects(activation.getActivationEvidence({ ...env, WORKSPACE_ID: 'ws_other' }, 'request'), /No such request/);
  });
  console.log(`\n${checks} activation checks passed; no live provider requests.`);
} finally { sqlite.close(); await rm(temp, { recursive: true, force: true }); }
