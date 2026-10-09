/** Bounded hosted cron regressions against migrated in-memory SQLite. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'relay-maintenance-test-'));
const sqlite = new DatabaseSync(':memory:');
const originalFetch = globalThis.fetch;
const now = 1_800_000_000_000, DAY = 86_400_000;
const PAID_D1_QUERY_LIMIT = 1000;
// The complete maximum-backlog fixture measures 661 statements after resource
// admissions, metadata storage controls, and bounded authentication cleanup.
// Keep a 670 ceiling and at least 330 statements below the paid D1 cap. This is
// a statement count, not a CPU cost estimate. Beta dispatch has its separate
// four-workspace/one-launch budget tested independently below.
const SQL_REGRESSION_CEILING = 670;
let checks = 0, sqlCalls = 0;
let providerFailure = false;
const providerCalls = [];
const activationProviderCalls = [];
let activationHttpStatus = 200;
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { sqlCalls++; return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { sqlCalls++; return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() { sqlCalls++; return { meta: sqlite.prepare(this.sql).run(...this.values), success: true }; }
}
const DB = {
  prepare: (sql) => new Statement(sql),
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const result = statements.map((s) => {
        sqlCalls++;
        const statement = sqlite.prepare(s.sql);
        if (statement.columns().length) return { results: statement.all(...s.values), meta: sqlite.prepare('SELECT changes() changes').get(), success: true };
        return { results: [], meta: statement.run(...s.values), success: true };
      });
      sqlite.exec('COMMIT'); return result;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const env = { DB, HOSTED: 'true' };
const issuer = 'https://maintenance-fixture.clerk.accounts.dev';
const clerkEnv = { ...env, AUTH_PROVIDER: 'clerk', PUBLIC_URL: 'https://relay.example.test', CLERK_ISSUER: issuer,
  CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from(new URL(issuer).hostname + '$').toString('base64'),
  CLERK_SECRET_KEY: 'sk_test_synthetic_maintenance_only', CLERK_ALLOW_DEVELOPMENT: 'true' };
globalThis.fetch = async (input, options) => {
  const req = input instanceof Request ? input : new Request(input, options), url = new URL(req.url);
  if (url.origin === 'https://api.anthropic.com') {
    assert.match(url.pathname, /^\/v1\/claude_code\/routines\/trig_maintenance_[a-z0-9-]+\/fire$/);
    assert.equal(req.method, 'POST'); assert.equal(req.headers.get('authorization'), 'Bearer sk-ant-oat01-SYNTHETIC_MAINTENANCE_ONLY');
    activationProviderCalls.push(JSON.parse(JSON.parse(await req.text()).text));
    return activationHttpStatus === 200 ? Response.json({ type: 'routine_fire', claude_code_session_id: 'session_maintenance', claude_code_session_url: 'https://claude.ai/code/session_maintenance' }) : new Response(null, { status: activationHttpStatus, headers: { 'Retry-After': '60' } });
  }
  assert.equal(url.origin, 'https://api.clerk.com', 'Maintenance tests never contact live services or unexpected origins');
  assert.equal(req.headers.get('authorization'), `Bearer ${clerkEnv.CLERK_SECRET_KEY}`);
  assert.ok((req.method === 'DELETE' && /^\/v1\/users\/user_delete_\d+$/.test(url.pathname)) ||
    (req.method === 'POST' && /^\/v1\/sessions\/sess_retry_\d+\/revoke$/.test(url.pathname)), 'Only fixture cleanup actions are permitted');
  providerCalls.push({ method: req.method, path: url.pathname });
  if (providerFailure) return Response.json({ errors: [{ code: 'service_unavailable', message: 'Synthetic outage' }] }, { status: 503 });
  return Response.json(req.method === 'DELETE' ? { object: 'user', id: url.pathname.split('/').at(-1), deleted: true } :
    { object: 'session', id: url.pathname.split('/').at(-2), status: 'revoked' });
};
const count = (table, where = '1=1') => sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get().n;
const check = async (name, fn) => { await fn(); checks++; console.log(`ok ${checks} - ${name}`); };
function reset() {
  for (const table of ['oauth_tokens', 'oauth_codes', 'oauth_grants', 'oauth_clients', 'oauth_requests', 'auth_sessions', 'auth_login_states', 'auth_rate_limits', 'clerk_actions', 'account_deletions', 'clerk_session_revocations', 'identity_tombstones', 'pairing_codes', 'users']) sqlite.exec(`DELETE FROM ${table}`);
  for (const table of ['wake_deliveries', 'claims', 'events', 'schedules', 'jobs', 'agents', 'activation_launch_attempts', 'resource_operation_budgets', 'resource_lane_budgets']) sqlite.exec(`DELETE FROM ${table}`);
  sqlite.exec("DELETE FROM workspaces WHERE id<>'default'; UPDATE workspaces SET last_maintenance_at=0,last_activation_at=0,paused=0,next_release_beta=0;");
  sqlCalls = 0;
  providerFailure = false; providerCalls.length = 0; activationProviderCalls.length = 0; activationHttpStatus = 200;
}
function workspace(id, retention = 30, paused = 0) {
  sqlite.prepare('INSERT INTO workspaces(id,name,created_at,retention_days,paused) VALUES (?,?,?,?,?)').run(id, id, now, retention, paused);
}
function job(workspaceId, id, extras = {}) {
  const row = { id, workspace_id: workspaceId, v: '1', type: 'task', from_agent: 'owner', to_agent: 'worker', title: 'Task', spec: '{"goal":"A task"}', status: 'queued', lease_seconds: 300, created_at: extras.completed_at ?? now, updated_at: extras.completed_at ?? now, ...extras };
  sqlite.prepare(`INSERT INTO jobs(${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
}
function schedule(workspaceId, id = 'schedule', request = {}, from = 'owner', extras = {}) {
  const row = { workspace_id: workspaceId, id, every_minutes: 5, template: JSON.stringify({ from, request: { type: 'task', to: `worker-${workspaceId}`, title: 'Scheduled task', goal: 'Do a scheduled task', ...request } }), next_run_at: now - 1, next_attempt_at: now - 1, created_at: now, ...extras };
  sqlite.prepare(`INSERT INTO schedules(${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
}
function agent(workspaceId, prefix = 'worker', requester = false) {
  const id = `${prefix}-${workspaceId}`;
  sqlite.prepare('INSERT INTO agents(id,workspace_id,handle,name,token_hash,can_work,can_request,work_types,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, workspaceId, prefix, id, id, requester ? 0 : 1, requester ? 1 : 0, '["task"]', now);
  return id;
}
function clerkBacklog() {
  // Four pending deletions and six due provider actions exceed the per-tick
  // caps, so the fixture verifies both completed work and the remaining backlog.
  for (let i = 0; i < 4; i++) {
    const ws = `delete-${i}`, user = `local-delete-${i}`, subject = `user_delete_${i}`, session = `session-delete-${i}`;
    workspace(ws, 30, 1); const worker = agent(ws);
    const identity = JSON.stringify(['clerk', issuer, subject]);
    sqlite.prepare('INSERT INTO users(id,google_sub,identity_key,email,name,workspace_id,created_at) VALUES (?,?,?,?,?,?,?)').run(user, identity, identity, `delete-${i}@example.test`, 'Delete fixture', ws, now);
    sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,csrf_token,created_at,expires_at,provider,provider_session_id) VALUES (?,?,?,?,?,?,?)').run(session, user, `csrf-${i}`, now, now + DAY, 'clerk', `sess_delete_${i}`);
    sqlite.prepare('INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES (?,?,?,?)').run(`client-${i}`, 'Fixture', '[]', now);
    sqlite.prepare('INSERT INTO oauth_grants(id,user_id,workspace_id,agent_id,auth_generation,client_id,scope,resource,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(`grant-${i}`, user, ws, worker, 1, `client-${i}`, 'relay:read', clerkEnv.PUBLIC_URL + '/mcp', now);
    sqlite.prepare('INSERT INTO oauth_codes(code_hash,grant_id,redirect_uri,code_challenge,expires_at) VALUES (?,?,?,?,?)').run(`code-${i}`, `grant-${i}`, 'http://127.0.0.1/callback', 'fixture', now + DAY);
    sqlite.prepare('INSERT INTO oauth_tokens(token_hash,grant_id,kind,created_at,expires_at) VALUES (?,?,?,?,?)').run(`token-${i}`, `grant-${i}`, 'access', now, now + DAY);
    sqlite.prepare('INSERT INTO oauth_requests(id_hash,session_hash,payload,expires_at) VALUES (?,?,?,?)').run(`request-${i}`, session, '{}', now + DAY);
    sqlite.prepare('INSERT INTO pairing_codes(code_hash,workspace_id,agent_id,auth_generation,created_at,expires_at) VALUES (?,?,?,?,?,?)').run(`pair-${i}`, ws, worker, 1, now, now + DAY);
    job(ws, `job-${ws}`); schedule(ws);
    sqlite.prepare('INSERT INTO claims(token_hash,workspace_id,job_id,agent_id,attempt,issued_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(`claim-${ws}`, ws, `job-${ws}`, worker, 1, now, now + DAY);
    sqlite.prepare('INSERT INTO events(workspace_id,ts,actor,kind) VALUES (?,?,?,?)').run(ws, now, 'relay', 'fixture');
    sqlite.prepare('INSERT INTO wake_deliveries(workspace_id,job_id,agent_id,generation,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(ws, `job-${ws}`, worker, 1, now, now, now);
    sqlite.prepare('INSERT INTO account_deletions(user_id,workspace_id,created_at) VALUES (?,?,?)').run(user, ws, now + i);
  }
  for (let i = 0; i < 6; i++) sqlite.prepare('INSERT INTO clerk_actions(id,action,issuer,subject,created_at,next_attempt_at) VALUES (?,?,?,?,?,?)')
    .run(`action-${i}`, i < 4 ? 'delete_user' : 'revoke_session', issuer, i < 4 ? `user_delete_${i}` : `sess_retry_${i}`, now - 10 + i, now - 10 + i);
  sqlite.prepare('INSERT INTO auth_login_states(state_hash,browser_hash,verifier,return_to,expires_at) VALUES (?,?,?,?,?)').run('old-state', 'browser', 'verifier', '/', now - 1);
  sqlite.prepare('INSERT INTO auth_rate_limits(bucket,count,expires_at) VALUES (?,?,?)').run('old-rate', 1, now - 1);
  sqlite.prepare('INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES (?,?,?,?)').run('old-client', 'Expired', '[]', now - 31 * DAY);
  sqlite.prepare('INSERT INTO pairing_codes(code_hash,workspace_id,agent_id,auth_generation,created_at,expires_at) VALUES (?,?,?,?,?,?)').run('old-pair', 'default', 'none', 1, now - 3 * DAY, now - 2 * DAY);
}
function queryBudget(label) {
  assert.ok(sqlCalls <= SQL_REGRESSION_CEILING, `${label}: ${sqlCalls} measured SQL statements exceed regression ceiling ${SQL_REGRESSION_CEILING}`);
  assert.ok(sqlCalls < PAID_D1_QUERY_LIMIT, `${label} must leave headroom below the paid D1 invocation limit`);
  console.log(`  measured ${sqlCalls} SQL statements for ${label} (complete scheduled handler)`);
}
try {
  for (const file of (await readdir(join(root, 'migrations'))).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(root, 'migrations', file), 'utf8'));
  const modulePath = join(temporary, 'maintenance.mjs');
  await build({ stdin: { contents: "export * from './src/maintenance'; export {runSchedules,pruneWorkspace,sweep} from './src/store'; export {saveActivation} from './src/activation'; export {default as relay} from './src/index';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: modulePath, logLevel: 'silent' });
  const api = await import(pathToFileURL(modulePath).href);
  async function cron(settings = env, at = now) {
    const realNow = Date.now, background = [];
    Date.now = () => at;
    try {
      await api.relay.scheduled({}, settings, { waitUntil: (promise) => background.push(promise) });
      assert.equal(background.length, 1, 'Exercise the complete scheduled Worker invocation');
      await Promise.all(background);
    } finally { Date.now = realNow; }
  }

  await check('1,000 idle workspaces incur three fixed service statements and no workspace maintenance writes', async () => {
    reset(); for (let i = 0; i < 1000; i++) workspace(`idle-${i}`);
    assert.deepEqual(await api.scheduledMaintenance(env, '', now), { workspaces: 0, failed: 0, requeued: 0, created: 0 });
    assert.equal(sqlCalls, 3, 'One global admission, bounded launch-ledger cleanup, and discovery; no per-tenant queries');
    assert.equal(count('workspaces', 'last_maintenance_at<>0'), 0);
    assert.equal(count('resource_operation_budgets', "scope_type='workspace'"), 0);
  });
  await check('protected maintenance prunes despite exhausted work budgets and stops without writes at its own cap', async () => {
    const exhaustedWork = { ...env, RESOURCE_GLOBAL_DAILY_OPERATIONS: '0', RESOURCE_GLOBAL_MONTHLY_OPERATIONS: '0',
      RESOURCE_WORKSPACE_DAILY_OPERATIONS: '0', RESOURCE_WORKSPACE_MONTHLY_OPERATIONS: '0' };
    const fixture = () => {
      reset(); workspace('budget-cleanup', 1);
      job('budget-cleanup', 'retained-completed', { status: 'completed', completed_at: now - 2 * DAY });
    };
    fixture();
    assert.deepEqual(await api.scheduledMaintenance(exhaustedWork, '', now), { workspaces: 1, failed: 0, requeued: 0, created: 0 });
    assert.equal(sqlite.prepare("SELECT spec FROM jobs WHERE id='retained-completed'").get().spec, '{}', 'Protected maintenance must actually prune the retained payload');
    const budget = sqlite.prepare("SELECT day_used,month_used FROM resource_lane_budgets WHERE lane='maintenance' AND scope_type='global' AND scope_id='service'").get();
    assert.equal(budget.day_used, 21); assert.equal(budget.month_used, 21);
    assert.equal(count('resource_lane_budgets'), 1); assert.equal(count('resource_operation_budgets'), 0);

    fixture();
    const untouched = sqlite.prepare("SELECT * FROM jobs WHERE id='retained-completed'").get();
    const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
    sqlCalls = 0;
    const stopped = await api.scheduledMaintenance({ ...exhaustedWork,
      RESOURCE_MAINTENANCE_DAILY_OPERATIONS: '0', RESOURCE_MAINTENANCE_MONTHLY_OPERATIONS: '0' }, '', now);
    assert.deepEqual(stopped, { workspaces: 0, failed: 0, requeued: 0, created: 0 });
    assert.deepEqual(sqlite.prepare("SELECT * FROM jobs WHERE id='retained-completed'").get(), untouched);
    assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n, before, 'Denied maintenance must not perform any writes');
    assert.equal(count('resource_lane_budgets'), 0); assert.equal(count('resource_operation_budgets'), 0);
    assert.ok(sqlCalls <= 2, `Denied maintenance must stop at admission and its status read; measured ${sqlCalls} statements`);
  });
  const activationEnv = { ...env, HOSTED_ACTIVATION_ENABLED: 'true', ENCRYPTION_KEY: 'synthetic-activation-maintenance-key', PUBLIC_URL: 'https://relay.example.test' };
  async function activationFixture(id, jobs = 1) {
    workspace(id); sqlite.prepare('UPDATE workspaces SET next_release_beta=1 WHERE id=?').run(id);
    const recipient = agent(id);
    // This case measures fair dispatch rotation with capacity for every queued
    // fixture task; separate activation regressions exercise occupied slots.
    sqlite.prepare('UPDATE agents SET max_leases=? WHERE id=?').run(jobs, recipient);
    for (let i = 0; i < jobs; i++) job(id, `${id}-request-${i}`, { to_agent: recipient });
    await api.saveActivation({ ...activationEnv, WORKSPACE_ID: id }, { owner: true, agent: null }, recipient, {
      endpoint: `https://api.anthropic.com/v1/claude_code/routines/trig_maintenance_${id}/fire`, token: 'sk-ant-oat01-SYNTHETIC_MAINTENANCE_ONLY', enabled: true,
    }, now);
  }
  await check('beta idle tenants stay read-only and disabled beta cannot dispatch a configured routine', async () => {
    reset(); for (let i = 0; i < 1000; i++) workspace(`beta-idle-${i}`);
    sqlite.exec('UPDATE workspaces SET next_release_beta=1');
    sqlCalls = 0; assert.deepEqual(await api.takeDueMaintenanceWorkspaces(activationEnv, now), []); assert.equal(sqlCalls, 1);
    await activationFixture('beta-disabled'); sqlite.exec("UPDATE workspaces SET next_release_beta=0 WHERE id='beta-disabled'");
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(activationEnv, now), []); await cron(activationEnv); assert.equal(activationProviderCalls.length, 0);
  });
  await check('beta dispatch budgets permit four workspaces and one launch each with persistent fair rotation', async () => {
    reset(); for (let i = 0; i < 8; i++) await activationFixture(`beta-${i}`, 2);
    sqlCalls = 0; await cron(activationEnv); assert.equal(activationProviderCalls.length, 4); queryBudget('four beta provider launches');
    assert.equal(count('activation_dispatches', "status='launched'"), 4);
    const firstRecipients = new Set(activationProviderCalls.map(call => call.hitchhike_request_id.split('-request-')[0])); assert.equal(firstRecipients.size, 4);
    await cron(activationEnv, now + 300_000); assert.equal(activationProviderCalls.length, 8);
    assert.equal(new Set(activationProviderCalls.map(call => call.hitchhike_request_id.split('-request-')[0])).size, 8, 'A busy first group cannot starve later beta workspaces');
    await cron(activationEnv, now + 600_000); assert.equal(activationProviderCalls.length, 12);
    await cron(activationEnv, now + 900_000); assert.equal(activationProviderCalls.length, 16);
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(activationEnv, now + 900_001), []);
  });
  await check('activation discovery respects Retry-After and recovers interrupted launches without refiring', async () => {
    reset(); await activationFixture('retry'); activationHttpStatus = 429;
    await cron(activationEnv); assert.equal(activationProviderCalls.length, 1);
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(activationEnv, now + 59_999), []);
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(activationEnv, now + 60_000), ['retry']);
    activationHttpStatus = 200; await cron(activationEnv, now + 60_000); assert.equal(activationProviderCalls.length, 2);
    assert.equal(count('activation_dispatches', "status='launched'"), 1);
    sqlite.exec(`UPDATE activation_dispatches SET status='dispatching',reserved_until=${now + 60_001}`);
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(activationEnv, now + 60_001), ['retry']);
    await cron(activationEnv, now + 60_001); assert.equal(activationProviderCalls.length, 2); assert.equal(count('activation_dispatches', "status='uncertain'"), 1);
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(activationEnv, now + 120_000), []);
  });
  await check('discovery finds each due category without selecting future work or scrubbed receipts', async () => {
    reset();
    for (const id of ['lease','expiry','schedule','content','receipt','event','claim','future','scrubbed','paused']) workspace(id, 1, id === 'paused' ? 1 : 0);
    job('lease', 'lease-job', { status: 'claimed', lease_expires_at: now - 1 });
    job('expiry', 'expired-job', { expires_at: now - 1 });
    schedule('schedule'); schedule('paused'); schedule('future', 'future', {}, 'owner', { next_run_at: now + DAY });
    job('content', 'content-job', { status: 'completed', completed_at: now - 2 * DAY });
    job('receipt', 'receipt-job', { status: 'completed', spec: '{}', completed_at: now - 36 * DAY, created_at: now - 37 * DAY });
    job('scrubbed', 'scrubbed-job', { status: 'completed', spec: '{}', completed_at: now - 2 * DAY, created_at: now - 3 * DAY });
    sqlite.exec("DELETE FROM conversations WHERE workspace_id='scrubbed'");
    sqlite.prepare("INSERT INTO events(workspace_id,ts,actor,kind) VALUES ('event',?,'relay','test')").run(now - 2 * DAY);
    sqlite.prepare("INSERT INTO claims(token_hash,workspace_id,job_id,agent_id,attempt,issued_at,expires_at) VALUES ('old','claim','none','none',1,?,?)").run(now - 2 * DAY, now - 2 * DAY);
    assert.deepEqual(new Set(await api.takeDueMaintenanceWorkspaces(env, now)), new Set(['lease','expiry','schedule','content','receipt','event','claim']));
    const paused = await api.takeDueMaintenanceWorkspaces({ ...env, SERVICE_PAUSED: 'true' }, now + 1);
    assert.ok(!paused.includes('schedule')); assert.ok(paused.includes('content'));
  });
  await check('persistent rotation covers 45 continuously due workspaces without starvation', async () => {
    reset(); for (let i = 0; i < 45; i++) { const id = `busy-${String(i).padStart(2, '0')}`; workspace(id); schedule(id); }
    const first = await api.takeDueMaintenanceWorkspaces(env, now);
    const second = await api.takeDueMaintenanceWorkspaces(env, now + 300_000);
    const third = await api.takeDueMaintenanceWorkspaces(env, now + 600_000);
    assert.equal(first.length, 20); assert.equal(second.length, 20); assert.equal(third.length, 20);
    assert.equal(first.filter((id) => second.includes(id)).length, 0);
    assert.equal(new Set([...first, ...second, ...third]).size, 45);
  });
  await check('20 workspaces with 10 due schedules each attempt only one each within the SQL budget', async () => {
    reset();
    for (let i = 0; i < 25; i++) {
      const id = `load-${i}`; workspace(id); agent(id); const sender = agent(id, 'requester', true);
      job(id, `parent-${id}`, { from_agent: sender, status: 'completed', completed_at: now });
      for (let s = 0; s < 10; s++) schedule(id, `schedule-${s}`, { parent_id: `parent-${id}` }, sender);
    }
    sqlCalls = 0; await cron();
    assert.equal(count('jobs', "idempotency_key LIKE 'schedule:%'"), 20);
    assert.equal(count('workspaces', 'last_maintenance_at<>0'), 20);
    assert.equal(count('schedules', 'last_attempt_at<>0'), 20);
    queryBudget('twenty successful schedules and global cleanup');
    // Force quota failure after validation and insert checks: this follows the
    // most expensive normal failure path, including the idempotency winner read.
    sqlite.exec('UPDATE workspaces SET daily_job_limit=0; UPDATE schedules SET last_attempt_at=0;');
    sqlCalls = 0; await cron(env, now + 300_000);
    assert.equal(count('jobs', "idempotency_key LIKE 'schedule:%'"), 20);
    assert.equal(count('events', "kind='schedule_failed'"), 20);
    queryBudget('twenty quota-rejected schedules and global cleanup');
  });
  await check('expired jobs add rows, not per-job SQL calls, across all 20 selected workspaces', async () => {
    reset();
    for (let w = 0; w < 20; w++) {
      const id = `expiry-load-${w}`; workspace(id); agent(id); const sender = agent(id, 'requester', true);
      job(id, `parent-${id}`, { from_agent: sender, status: 'completed', completed_at: now });
      for (let j = 0; j < 20; j++) {
        if (j < 7) job(id, `${id}-${j}`, { status: 'claimed', lease_expires_at: now - 1, attempts: 1 });
        else if (j < 14) job(id, `${id}-${j}`, { status: 'claimed', lease_expires_at: now - 1, attempts: 3 });
        else job(id, `${id}-${j}`, { expires_at: now - 1 });
      }
      schedule(id, 'scheduled-after-sweep', { parent_id: `parent-${id}` }, sender);
    }
    sqlCalls = 0; await cron();
    assert.equal(count('workspaces', 'last_maintenance_at<>0'), 20);
    assert.equal(count('events', "kind='lease_expired'"), 140);
    assert.equal(count('events', "kind IN ('lease_expired','failed','expired')"), 400);
    assert.equal(count('events', "kind='schedule_failed'"), 20);
    queryBudget('400 expired jobs, twenty quota-rejected schedules, and global cleanup');
  });
  await check('maximum cron backlog includes bounded Clerk deletion and provider retry cleanup', async () => {
    for (const scenario of [{ failure: false, beta: false }, { failure: true, beta: false }, { failure: false, beta: true }]) {
      const { failure, beta } = scenario;
      reset(); clerkBacklog(); providerFailure = failure;
      for (let w = 0; w < 21; w++) {
        const id = `full-${String(w).padStart(2, '0')}`; workspace(id, 1); const recipient = agent(id); const sender = agent(id, 'requester', true);
        if (beta && w < 4) {
          sqlite.prepare('UPDATE workspaces SET next_release_beta=1 WHERE id=?').run(id);
          job(id, `activation-${id}`, { to_agent: recipient });
          await api.saveActivation({ ...activationEnv, WORKSPACE_ID: id }, { owner: true, agent: null }, recipient, { endpoint: `https://api.anthropic.com/v1/claude_code/routines/trig_maintenance_${id}/fire`, token: 'sk-ant-oat01-SYNTHETIC_MAINTENANCE_ONLY', enabled: true }, now);
        }
        job(id, `parent-${id}`, { from_agent: sender, status: 'completed', completed_at: now });
        for (let s = 0; s < 10; s++) schedule(id, `schedule-${s}`, { parent_id: `parent-${id}` }, sender);
        for (let j = 0; j < 101; j++) {
          job(id, `${id}-requeue-${j}`, { status: 'claimed', attempts: 1, lease_expires_at: now - 1 });
          job(id, `${id}-fail-${j}`, { status: 'claimed', attempts: 3, lease_expires_at: now - 1 });
          job(id, `${id}-expire-${j}`, { expires_at: now - 1 });
          job(id, `${id}-content-${j}`, { status: 'completed', completed_at: now - 2 * DAY });
          job(id, `${id}-receipt-${j}`, { status: 'completed', spec: '{}', completed_at: now - 36 * DAY, created_at: now - 37 * DAY });
          sqlite.prepare('INSERT INTO events(workspace_id,ts,actor,kind) VALUES (?,?,?,?)').run(id, now - 2 * DAY, 'relay', 'old');
          sqlite.prepare('INSERT INTO claims(token_hash,workspace_id,job_id,agent_id,attempt,issued_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(`${id}-claim-${j}`, id, 'none', 'none', 1, now - 2 * DAY, now - 2 * DAY);
        }
      }
      sqlCalls = 0; await cron(beta ? { ...clerkEnv, HOSTED_ACTIVATION_ENABLED: 'true', ENCRYPTION_KEY: activationEnv.ENCRYPTION_KEY } : clerkEnv);
      assert.equal(count('workspaces', "id LIKE 'full-%' AND last_maintenance_at<>0"), 20);
      assert.equal(count('schedules', "workspace_id LIKE 'full-%' AND last_attempt_at<>0"), 20);
      assert.equal(count('events', "kind IN ('lease_expired','failed','expired')"), 6000);
      assert.equal(count('events', "kind='schedule_failed'"), 20);
      assert.equal(count('jobs', "workspace_id='full-00' AND status='claimed'"), 2);
      assert.equal(count('jobs', "workspace_id='full-00' AND id LIKE '%content-%' AND spec<>'{}'"), 101, 'The first 100 complete-thread removals process the oldest receipt conversations before newer content');
      assert.equal(count('jobs', "workspace_id='full-00' AND id LIKE '%receipt-%'"), 1);
      assert.equal(count('claims', "workspace_id='full-00'"), 1);
      assert.equal(count('events', "workspace_id='full-00' AND kind='old'"), 1);
      assert.equal(count('account_deletions'), 1, 'Only three pending account deletions run per invocation');
      assert.equal(count('users'), 1); assert.equal(count('oauth_grants'), 1); assert.equal(count('oauth_tokens'), 1); assert.equal(count('oauth_codes'), 1);
      assert.equal(count('wake_deliveries'), 1); assert.equal(count('pairing_codes'), 1);
      assert.equal(count('auth_sessions'), 1); assert.equal(count('oauth_requests'), 1); assert.equal(count('clerk_session_revocations'), 3);
      assert.equal(count('auth_login_states'), 0); assert.equal(count('auth_rate_limits'), 0); assert.equal(count('oauth_clients', "id='old-client'"), 0);
      assert.equal(providerCalls.length, 5, 'At most five due provider actions are attempted');
      assert.ok(providerCalls.every((call) => !call.path.includes('sess_retry_5')), 'The sixth provider action remains for another tick');
      assert.equal(count('clerk_actions'), failure ? 6 : 1);
      assert.equal(count('clerk_actions', 'attempts=1 AND next_attempt_at>' + now), failure ? 5 : 0, 'Provider failures retain a future retry');
      assert.equal(count('clerk_actions', "id='action-5' AND attempts=0"), 1);
      if (beta) {
        assert.equal(activationProviderCalls.length, 4);
        assert.ok(sqlCalls <= 800, `Combined beta/workspace/auth backlog must fit its bounded 800-statement budget (observed ${sqlCalls})`);
        assert.ok(sqlCalls < PAID_D1_QUERY_LIMIT);
        console.log(`  measured ${sqlCalls} SQL statements for combined beta/workspace/auth backlog (four provider launches)`);
      } else queryBudget(`maximum workspace/auth backlog with provider ${failure ? 'failures' : 'success'}`);
    }
  });
  await check('one workspace failure does not stop its peers and remains eligible for retry', async () => {
    reset();
    for (const id of ['broken', 'working']) { workspace(id); job(id, `job-${id}`, { expires_at: now - 1 }); }
    const failDB = { ...DB, async batch(statements) {
      if (statements[0].values[1] === 'broken') throw new Error('Simulated database failure');
      return DB.batch(statements);
    } };
    const result = await api.scheduledMaintenance({ ...env, DB: failDB }, '', now);
    assert.equal(result.failed, 1); assert.equal(result.workspaces, 2);
    assert.equal(sqlite.prepare("SELECT status FROM jobs WHERE workspace_id='working'").get().status, 'expired');
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(env, now + 1), ['broken']);
  });
  await check('a failed schedule preserves its slot while a sibling gets the next attempt', async () => {
    reset(); workspace('fair'); agent('fair'); schedule('fair', 'a-broken', { to: 'missing' }); schedule('fair', 'b-good');
    const scoped = { ...env, WORKSPACE_ID: 'fair' };
    assert.equal((await api.runSchedules(scoped, now, 1)).length, 0);
    assert.equal(sqlite.prepare("SELECT next_run_at FROM schedules WHERE id='a-broken'").get().next_run_at, now - 1);
    assert.equal((await api.runSchedules(scoped, now + 1, 1)).length, 1);
    assert.equal(count('jobs'), 1); assert.equal(count('events', "kind='schedule_failed'"), 1);
    assert.equal(sqlite.prepare("SELECT next_attempt_at FROM schedules WHERE id='a-broken'").get().next_attempt_at, now + 300_000);
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(env, now + 2), []);
  });
  await check('backed-off schedules do not consume discovery slots while unrelated work stays discoverable', async () => {
    reset(); workspace('backoff'); agent('backoff'); schedule('backoff', 'broken', { to: 'missing' });
    await api.runSchedules({ ...env, WORKSPACE_ID: 'backoff' }, now, 1);
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(env, now + 299_999), []);
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(env, now + 300_000), ['backoff']);
    job('backoff', 'expired-despite-backoff', { expires_at: now - 1 });
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(env, now + 1), ['backoff']);
  });
  await check('cleanup processes at most 100 rows per category and stays due until drained', async () => {
    reset(); workspace('cleanup', 1);
    for (let i = 0; i < 101; i++) {
      job('cleanup', `content-${i}`, { status: 'completed', completed_at: now - 2 * DAY });
      sqlite.prepare("INSERT INTO events(workspace_id,ts,actor,kind) VALUES ('cleanup',?,'relay','test')").run(now - 2 * DAY);
      sqlite.prepare("INSERT INTO claims(token_hash,workspace_id,job_id,agent_id,attempt,issued_at,expires_at) VALUES (?,'cleanup','none','none',1,?,?)").run(`claim-${i}`, now - 2 * DAY, now - 2 * DAY);
    }
    const scoped = { ...env, WORKSPACE_ID: 'cleanup' };
    await api.pruneWorkspace(scoped, now);
    assert.equal(count('jobs', "spec<>'{}'"), 1); assert.equal(count('events'), 1); assert.equal(count('claims'), 1);
    assert.deepEqual(await api.takeDueMaintenanceWorkspaces(env, now), ['cleanup']);
    await api.pruneWorkspace(scoped, now); assert.deepEqual(await api.takeDueMaintenanceWorkspaces(env, now), []);
    for (let i = 0; i < 101; i++) job('cleanup', `receipt-${i}`, { status: 'completed', spec: '{}', created_at: now - 40 * DAY, completed_at: now - 36 * DAY });
    await api.pruneWorkspace(scoped, now); assert.equal(count('jobs', `completed_at<${now - 35 * DAY}`), 1);
  });
  await check('bounded lease transitions audit exactly the rows they mutate', async () => {
    reset(); workspace('sweep');
    for (let i = 0; i < 101; i++) {
      job('sweep', `requeue-${i}`, { status: 'claimed', lease_expires_at: now - 1, attempts: 1 });
      job('sweep', `fail-${i}`, { status: 'claimed', lease_expires_at: now - 1, attempts: 3 });
      job('sweep', `expire-${i}`, { expires_at: now - 1 });
    }
    const scoped = { ...env, WORKSPACE_ID: 'sweep' };
    assert.equal((await api.sweep(scoped, now, 100)).length, 100);
    assert.equal(count('events'), 300); assert.equal(count('jobs', "status='claimed'"), 2);
    assert.equal(count('jobs', "status='failed'"), 100); assert.equal(count('jobs', "status='expired'"), 100);
    assert.equal((await api.sweep(scoped, now + 1, 100)).length, 1); assert.equal(count('events'), 303);
  });
  console.log(`\n${checks} maintenance regressions passed.`);
} finally { globalThis.fetch = originalFetch; sqlite.close(); await rm(temporary, { recursive: true, force: true }); }
