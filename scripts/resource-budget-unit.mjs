/** Resource admission regressions against the real migrations and SQLite. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-resource-budget-test-'));
const now = Date.parse('2026-01-30T23:59:59.500Z');
const sqlite = new DatabaseSync(':memory:');
let checks = 0;
let sqlCalls = 0;

function d1(database) {
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first(column) {
      sqlCalls++;
      const row = database.prepare(this.sql).get(...this.values);
      return column ? (row?.[column] ?? null) : (row ?? null);
    }
    async all() {
      sqlCalls++;
      return { results: database.prepare(this.sql).all(...this.values), success: true };
    }
    async run() {
      sqlCalls++;
      return { results: [], meta: database.prepare(this.sql).run(...this.values), success: true };
    }
  }
  return {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const result = statements.map((statement) => {
          sqlCalls++;
          const prepared = database.prepare(statement.sql);
          if (prepared.columns().length) {
            return { results: prepared.all(...statement.values), meta: database.prepare('SELECT changes() AS changes').get(), success: true };
          }
          return { results: [], meta: prepared.run(...statement.values), success: true };
        });
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const DB = d1(sqlite);
const env = {
  DB,
  HOSTED: 'true',
  RESOURCE_GLOBAL_DAILY_OPERATIONS: '1000',
  RESOURCE_GLOBAL_MONTHLY_OPERATIONS: '10000',
  RESOURCE_WORKSPACE_DAILY_OPERATIONS: '1000',
  RESOURCE_WORKSPACE_MONTHLY_OPERATIONS: '10000',
  RESOURCE_ESSENTIAL_RESERVE_PERCENT: '0',
};
const check = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const totalChanges = () => sqlite.prepare('SELECT total_changes() AS n').get().n;
const rows = () => sqlite.prepare('SELECT * FROM resource_operation_budgets ORDER BY scope_type,scope_id').all();
const row = (type, id) => sqlite.prepare('SELECT * FROM resource_operation_budgets WHERE scope_type=? AND scope_id=?').get(type, id);
const reset = () => { sqlite.exec('DELETE FROM resource_operation_budgets'); sqlCalls = 0; };
const counters = () => rows().map(({ scope_type, scope_id, day_used, month_used }) => ({ scope_type, scope_id, day_used, month_used }));

try {
  for (const migration of (await readdir(join(root, 'migrations'))).filter((file) => file.endsWith('.sql')).sort()) {
    sqlite.exec(await readFile(join(root, 'migrations', migration), 'utf8'));
  }
  for (const id of ['enabled', 'weighted', 'limited', 'too-small', 'first', 'second', 'race', 'initial', 'reserve',
    'monthly-reserve', 'paused', 'rollover', 'status', 'neighbor', "tenant' OR 1=1 --", 'assertion', 'sql-abort',
    ...Array.from({ length: 32 }, (_, index) => `global-race-${index}`)]) {
    sqlite.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)').run(id, id, now);
  }
  const modulePath = join(temporary, 'budgets.mjs');
  await build({ entryPoints: [join(root, 'src/budgets.ts')], bundle: true, platform: 'node', format: 'esm', outfile: modulePath, logLevel: 'silent' });
  const api = await import(pathToFileURL(modulePath).href);

  await check('self-hosting bypasses admission and status without touching a database', async () => {
    const inaccessible = { prepare() { throw new Error('Database must remain untouched'); }, batch() { throw new Error('Database must remain untouched'); } };
    for (const settings of [{ DB: inaccessible }, { DB: inaccessible, HOSTED: 'false', RESOURCE_BUDGETS_ENABLED: 'false' }]) {
      const admitted = await api.admitResourceOperation(settings, 'selfhost', 'mutation', now);
      assert.equal(admitted.allowed, true);
      assert.equal(admitted.enabled, false);
      assert.equal((await api.resourceBudgetStatus(settings, 'selfhost', now)).enabled, false);
      await api.assertResourceOperation(settings, 'selfhost', 'new_work', now);
    }
  });

  await check('hosted budgets cannot be disabled and self-hosters can explicitly enable them', async () => {
    for (const settings of [
      { ...env, RESOURCE_BUDGETS_ENABLED: 'false' },
      { ...env, HOSTED: 'false', RESOURCE_BUDGETS_ENABLED: 'true' },
    ]) {
      reset();
      const result = await api.admitResourceOperation(settings, 'enabled', 'read', now);
      assert.equal(result.enabled, true);
      assert.equal(result.allowed, true);
      assert.equal(row('global', 'service').day_used, 1);
      assert.equal(row('workspace', 'enabled').day_used, 1);
    }
  });

  await check('operation weights and explicit costs debit both scopes once', async () => {
    const weights = { read: 1, poll: 2, mutation: 10, new_work: 10, essential_read: 1, result_read: 1, completion: 10, cancel: 10, auth: 10, export: 50, cleanup: 10 };
    for (const [operation, cost] of Object.entries(weights)) {
      reset();
      const result = await api.admitResourceOperation(env, 'weighted', operation, now);
      assert.equal(result.allowed, true, operation);
      assert.equal(result.cost, cost, operation);
      assert.equal(row('global', 'service').day_used, cost, operation);
      assert.equal(row('global', 'service').month_used, cost, operation);
      assert.equal(row('workspace', 'weighted').day_used, cost, operation);
      assert.equal(row('workspace', 'weighted').month_used, cost, operation);
    }
    reset();
    assert.equal((await api.admitResourceOperation(env, 'weighted', { cost: 7 }, now)).allowed, true);
    assert.equal(row('workspace', 'weighted').day_used, 7);
  });

  await check('unauthenticated admission consumes only the global scope', async () => {
    reset();
    const result = await api.admitResourceOperation(env, null, 'auth', now);
    assert.equal(result.allowed, true);
    assert.equal(rows().length, 1);
    assert.equal(row('global', 'service').day_used, 10);
    const status = await api.resourceBudgetStatus(env, null, now);
    assert.equal(status.global.day.used, 10);
    assert.ok(!status.workspace);
  });

  for (const [setting, scope, window] of [
    ['RESOURCE_GLOBAL_DAILY_OPERATIONS', 'global', 'day'],
    ['RESOURCE_GLOBAL_MONTHLY_OPERATIONS', 'global', 'month'],
    ['RESOURCE_WORKSPACE_DAILY_OPERATIONS', 'workspace', 'day'],
    ['RESOURCE_WORKSPACE_MONTHLY_OPERATIONS', 'workspace', 'month'],
  ]) {
    await check(`${scope} ${window} exhaustion blocks without charging either scope`, async () => {
      reset();
      const settings = { ...env, [setting]: '10' };
      assert.equal((await api.admitResourceOperation(settings, 'limited', 'mutation', now)).allowed, true);
      const beforeRows = rows();
      const beforeChanges = totalChanges();
      const denied = await api.admitResourceOperation(settings, 'limited', 'read', now);
      assert.equal(denied.allowed, false);
      assert.equal(denied.enabled, true);
      assert.equal(denied.reason, `${scope}_budget_exhausted`);
      assert.ok(denied.retryAfterSeconds > 0);
      assert.equal(totalChanges() - beforeChanges, 0, 'Rejection must not perform hidden writes');
      assert.deepEqual(rows(), beforeRows);
      const status = await api.resourceBudgetStatus(settings, 'limited', now);
      assert.equal(status[scope][window].used, 10);
      assert.equal(status[scope][window].remaining, 0);
      assert.equal(status[scope][window].near_limit, true);
    });
  }

  await check('an unaffordable first operation creates no global or workspace rows', async () => {
    reset();
    const before = totalChanges();
    assert.equal((await api.admitResourceOperation({ ...env, RESOURCE_WORKSPACE_DAILY_OPERATIONS: '5' }, 'too-small', 'mutation', now)).allowed, false);
    assert.equal(totalChanges() - before, 0);
    assert.deepEqual(rows(), []);
  });

  await check('a globally exhausted request cannot create or charge another workspace', async () => {
    reset();
    const settings = { ...env, RESOURCE_GLOBAL_DAILY_OPERATIONS: '10' };
    assert.equal((await api.admitResourceOperation(settings, 'first', 'mutation', now)).allowed, true);
    const before = totalChanges();
    assert.equal((await api.admitResourceOperation(settings, 'second', 'read', now)).allowed, false);
    assert.equal(totalChanges() - before, 0);
    assert.equal(row('workspace', 'second'), undefined);
    assert.equal(row('workspace', 'first').day_used, 10);
    assert.equal(row('global', 'service').day_used, 10);
  });

  await check('concurrent requests admit exactly one final workspace slot', async () => {
    reset();
    const settings = { ...env, RESOURCE_WORKSPACE_DAILY_OPERATIONS: '11' };
    await api.assertResourceOperation(settings, 'race', 'mutation', now);
    const results = await Promise.all(Array.from({ length: 32 }, () => api.admitResourceOperation(settings, 'race', 'read', now)));
    assert.equal(results.filter((result) => result.allowed).length, 1);
    assert.equal(row('workspace', 'race').day_used, 11);
    assert.equal(row('workspace', 'race').month_used, 11);
    assert.equal(row('global', 'service').day_used, 11);
    assert.equal(row('global', 'service').month_used, 11);
  });

  await check('concurrent different workspaces share one final global slot', async () => {
    reset();
    const settings = { ...env, RESOURCE_GLOBAL_DAILY_OPERATIONS: '11' };
    await api.assertResourceOperation(settings, 'initial', 'mutation', now);
    const results = await Promise.all(Array.from({ length: 32 }, (_, index) => api.admitResourceOperation(settings, `global-race-${index}`, 'read', now)));
    assert.equal(results.filter((result) => result.allowed).length, 1);
    assert.equal(row('global', 'service').day_used, 11);
    assert.equal(rows().filter((item) => item.scope_type === 'workspace').length, 2, 'Rejected contenders must not leave empty workspace rows');
    assert.equal(rows().filter((item) => item.scope_type === 'workspace').reduce((sum, item) => sum + item.day_used, 0), 11);
  });

  await check('the default essential reserve preserves result reads and cancellation', async () => {
    reset();
    const settings = { ...env, RESOURCE_GLOBAL_DAILY_OPERATIONS: '200', RESOURCE_WORKSPACE_DAILY_OPERATIONS: '200' };
    delete settings.RESOURCE_ESSENTIAL_RESERVE_PERCENT;
    assert.equal((await api.admitResourceOperation(settings, 'reserve', { cost: 180 }, now)).allowed, true);
    const before = totalChanges();
    assert.equal((await api.admitResourceOperation(settings, 'reserve', 'new_work', now)).allowed, false);
    assert.equal((await api.admitResourceOperation(settings, 'reserve', 'poll', now)).allowed, false);
    assert.equal(totalChanges() - before, 0);
    const status = await api.resourceBudgetStatus(settings, 'reserve', now);
    assert.equal(status.workspace.day.remaining, 20);
    assert.equal(status.workspace.day.standard_remaining, 0);
    assert.equal((await api.admitResourceOperation(settings, 'reserve', 'result_read', now)).allowed, true);
    assert.equal((await api.admitResourceOperation(settings, 'reserve', 'cancel', now)).allowed, true);
    assert.equal((await api.admitResourceOperation(settings, 'reserve', { cost: 9, essential: true }, now)).allowed, true);
    assert.equal(row('workspace', 'reserve').day_used, 200);
    const exhaustedChanges = totalChanges();
    assert.equal((await api.admitResourceOperation(settings, 'reserve', 'result_read', now)).allowed, false);
    assert.equal(totalChanges() - exhaustedChanges, 0, 'Essential operations still respect the hard cap');
  });

  await check('a configured reserve applies to monthly capacity as well as daily capacity', async () => {
    reset();
    const settings = { ...env, RESOURCE_ESSENTIAL_RESERVE_PERCENT: '25', RESOURCE_WORKSPACE_MONTHLY_OPERATIONS: '40' };
    assert.equal((await api.admitResourceOperation(settings, 'monthly-reserve', { cost: 30 }, now)).allowed, true);
    assert.equal((await api.admitResourceOperation(settings, 'monthly-reserve', 'read', now)).allowed, false);
    assert.equal((await api.admitResourceOperation(settings, 'monthly-reserve', 'completion', now)).allowed, true);
    const status = await api.resourceBudgetStatus(settings, 'monthly-reserve', now);
    assert.equal(status.workspace.month.used, 40);
    assert.equal(status.workspace.month.remaining, 0);
  });

  await check('new-work pause rejects creation without writes while existing work remains usable', async () => {
    reset();
    const settings = { ...env, NEW_WORK_PAUSED: 'true' };
    const before = totalChanges();
    for (const operation of ['new_work', { cost: 3, newWork: true }]) {
      const rejected = await api.admitResourceOperation(settings, 'paused', operation, now);
      assert.equal(rejected.allowed, false);
      assert.equal(rejected.reason, 'new_work_paused');
    }
    assert.equal(totalChanges() - before, 0);
    for (const operation of ['read', 'poll', 'mutation', 'result_read', 'completion', 'cancel', 'auth', 'export', 'cleanup']) {
      assert.equal((await api.admitResourceOperation(settings, 'paused', operation, now)).allowed, true, operation);
    }
    assert.equal((await api.resourceBudgetStatus(settings, 'paused', now)).new_work_paused, true);
  });

  await check('UTC day and month rollover reuse bounded rows and carry the correct counters', async () => {
    reset();
    const jan31 = Date.parse('2026-01-31T00:00:00.000Z');
    const feb1 = Date.parse('2026-02-01T00:00:00.000Z');
    await api.assertResourceOperation(env, 'rollover', 'mutation', now);
    const before = rows();
    const status = await api.resourceBudgetStatus(env, 'rollover', jan31);
    assert.equal(status.workspace.day.used, 0);
    assert.equal(status.workspace.month.used, 10);
    assert.equal(status.workspace.day.resets_at, '2026-02-01T00:00:00.000Z');
    assert.equal(status.workspace.month.resets_at, '2026-02-01T00:00:00.000Z');
    assert.deepEqual(rows(), before, 'Status must project new periods without changing stored counters');
    await api.assertResourceOperation(env, 'rollover', { cost: 4 }, jan31);
    assert.equal(row('workspace', 'rollover').day_used, 4);
    assert.equal(row('workspace', 'rollover').month_used, 14);
    await api.assertResourceOperation(env, 'rollover', { cost: 3 }, feb1);
    assert.equal(row('workspace', 'rollover').day_used, 3);
    assert.equal(row('workspace', 'rollover').month_used, 3);
    const currentRows = rows();
    const changesBeforeLateRequest = totalChanges();
    const late = await api.admitResourceOperation(env, 'rollover', 'read', jan31);
    assert.equal(late.allowed, false);
    assert.equal(late.reason, 'resource_budget_unavailable');
    assert.deepEqual(rows(), currentRows, 'Late admissions must not reset counters to an older period');
    assert.equal(totalChanges() - changesBeforeLateRequest, 0);
    for (let month = 2; month < 26; month++) {
      await api.assertResourceOperation(env, 'rollover', 'read', Date.UTC(2026, month, 1));
      assert.equal(rows().length, 2, 'Calendar windows must not grow the table');
      assert.equal(row('global', 'service').day_used, 1);
      assert.equal(row('workspace', 'rollover').month_used, 1);
    }
  });

  await check('status is read-only for empty, current, and stale windows', async () => {
    reset();
    let before = totalChanges();
    const empty = await api.resourceBudgetStatus(env, 'status', now);
    assert.equal(empty.enabled, true);
    assert.equal(empty.new_work_paused, false);
    for (const scope of ['global', 'workspace']) {
      for (const window of ['day', 'month']) {
        assert.equal(empty[scope][window].used, 0);
        assert.equal(empty[scope][window].remaining, empty[scope][window].limit);
        assert.equal(empty[scope][window].standard_remaining, empty[scope][window].limit);
        assert.equal(empty[scope][window].near_limit, false);
        assert.ok(empty[scope][window].resets_at);
      }
    }
    assert.equal(totalChanges() - before, 0);
    assert.deepEqual(rows(), []);
    await api.assertResourceOperation(env, 'status', 'mutation', now);
    const snapshot = rows();
    before = totalChanges();
    assert.equal((await api.resourceBudgetStatus(env, 'status', now)).workspace.day.used, 10);
    assert.equal((await api.resourceBudgetStatus(env, 'status', Date.parse('2026-02-01T00:00:00Z'))).workspace.month.used, 0);
    assert.equal(totalChanges() - before, 0);
    assert.deepEqual(rows(), snapshot);
  });

  await check('workspace IDs remain isolated even when they contain SQL punctuation', async () => {
    reset();
    const hostileId = "tenant' OR 1=1 --";
    await api.assertResourceOperation(env, hostileId, 'mutation', now);
    await api.assertResourceOperation(env, 'neighbor', 'read', now);
    assert.equal(row('workspace', hostileId).day_used, 10);
    assert.equal(row('workspace', 'neighbor').day_used, 1);
    assert.equal(row('global', 'service').day_used, 11);
    assert.equal(rows().length, 3);
  });

  await check('missing migration fails closed instead of silently permitting unmetered work', async () => {
    const missing = new DatabaseSync(':memory:');
    try {
      const settings = { ...env, DB: d1(missing) };
      const admission = await api.admitResourceOperation(settings, 'missing', 'read', now);
      assert.equal(admission.allowed, false);
      assert.equal(admission.enabled, true);
      assert.equal(admission.reason, 'resource_budget_unavailable');
      await assert.rejects(() => api.assertResourceOperation(settings, 'missing', 'read', now), (error) => {
        assert.ok(error instanceof api.ResourceBudgetError);
        assert.equal(error.status, 503);
        assert.equal(error.code, 'resource_budget_unavailable');
        return true;
      });
      assert.equal(missing.prepare('SELECT total_changes() AS n').get().n, 0);
    } finally { missing.close(); }
  });

  await check('assertion exposes a typed error when capacity is exhausted', async () => {
    reset();
    const settings = { ...env, RESOURCE_WORKSPACE_DAILY_OPERATIONS: '1' };
    await api.assertResourceOperation(settings, 'assertion', 'read', now);
    const before = counters();
    await assert.rejects(() => api.assertResourceOperation(settings, 'assertion', 'read', now), (error) => {
      assert.ok(error instanceof api.ResourceBudgetError);
      assert.equal(error.status, 429);
      assert.equal(error.code, 'workspace_budget_exhausted');
      return true;
    });
    assert.deepEqual(counters(), before);
  });

  await check('workspace SQL failures roll back the global admission atomically', async () => {
    for (const phase of ['INSERT', 'UPDATE']) {
      reset();
      if (phase === 'UPDATE') await api.assertResourceOperation(env, 'sql-abort', 'read', now);
      const snapshot = rows();
      sqlite.exec(`CREATE TEMP TRIGGER fail_workspace_budget BEFORE ${phase} ON resource_operation_budgets
        WHEN NEW.scope_type='workspace' BEGIN SELECT RAISE(ABORT,'Synthetic workspace budget failure'); END`);
      try {
        const result = await api.admitResourceOperation(env, 'sql-abort', 'mutation', now);
        assert.equal(result.allowed, false);
        assert.equal(result.reason, 'resource_budget_unavailable');
        assert.deepEqual(rows(), snapshot, `${phase} failure must leave both scopes unchanged`);
      } finally { sqlite.exec('DROP TRIGGER fail_workspace_budget'); }
    }
  });

  await check('unknown workspaces cannot create orphan resource counters', async () => {
    reset();
    const before = totalChanges();
    const result = await api.admitResourceOperation(env, 'does-not-exist', 'read', now);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'resource_budget_unavailable');
    assert.deepEqual(rows(), []);
    assert.equal(totalChanges() - before, 0);
  });

  await check('GET, POST and HEAD pickup charge the same poll allowance as MCP pickup', async () => {
    reset();
    const settings = { ...env, RESOURCE_WORKSPACE_DAILY_OPERATIONS: '4' };
    const mcpOperation = api.resourceOperationForTool('get_next_job');
    for (const method of ['GET', 'POST']) {
      const operation = api.resourceOperationForHttp(method, '/v1/work/next');
      assert.equal(operation, mcpOperation, method);
      const admission = await api.admitResourceOperation(settings, 'weighted', operation, now);
      assert.equal(admission.allowed, true, method);
      assert.equal(admission.cost, 2, method);
    }
    assert.equal(row('workspace', 'weighted').day_used, 4);
    const before = totalChanges();
    assert.equal((await api.admitResourceOperation(settings, 'weighted', api.resourceOperationForHttp('GET', '/v1/work/next'), now)).allowed, false);
    assert.equal(totalChanges(), before, 'GET pickup cannot bypass the exhausted polling allowance');
    reset();
    const headOperation = api.resourceOperationForHttp('HEAD', '/v1/work/next');
    assert.equal(headOperation, mcpOperation, 'Hono dispatches HEAD through the GET pickup handler');
    assert.equal((await api.admitResourceOperation(settings, 'weighted', headOperation, now)).cost, 2);
    assert.equal(row('workspace', 'weighted').day_used, 2);
  });

  await check('tool and HTTP classifiers protect new work and essential recovery paths', async () => {
    for (const [tool, operation] of Object.entries({
      send_job: 'new_work', send_message: 'new_work', answer_question: 'new_work', send_back: 'new_work',
      check_inbox: 'poll', check_conversation_inbox: 'poll', preview_requests: 'poll',
      get_job: 'result_read', get_conversation: 'result_read', submit_result: 'completion',
      acknowledge_results: 'completion', acknowledge_conversation: 'completion', reply_to_request: 'completion',
      ask_question: 'completion', give_up: 'completion', cancel_job: 'cancel', claim_request: 'mutation',
      get_next_job: 'poll', connection_status: 'essential_read', list_agents: 'read',
      get_collaboration_config: 'essential_read', list_conversations: 'read', unknown_tool: 'mutation',
    })) assert.equal(api.resourceOperationForTool(tool), operation, tool);
    for (const [method, path, operation] of [
      ['GET', '/v1/admin/export', 'export'], ['DELETE', '/v1/jobs/job-id', 'cancel'],
      ['POST', '/v1/jobs/job-id/cancel', 'cancel'], ['POST', '/auth/logout', 'auth'],
      ['POST', '/oauth/token', 'auth'], ['GET', '/v1/inbox', 'poll'],
      ['GET', '/v1/conversations/inbox', 'poll'], ['GET', '/v1/requests/pending', 'poll'],
      ['GET', '/v1/me', 'essential_read'], ['HEAD', '/v1/me', 'essential_read'],
      ['GET', '/v1/configuration', 'essential_read'], ['HEAD', '/v1/configuration', 'essential_read'],
      ['GET', '/v1/agents/agent-id/collaboration', 'read'],
      ['GET', '/v1/jobs/job-id', 'result_read'], ['GET', '/v1/conversations/thread-id', 'result_read'],
      ['HEAD', '/w/connection-id', 'result_read'], ['POST', '/v1/submit', 'completion'],
      ['POST', '/v1/heartbeat', 'completion'], ['POST', '/v1/requests/request-id/reply', 'completion'],
      ['POST', '/v1/jobs', 'new_work'], ['POST', '/v1/conversations', 'new_work'],
      ['POST', '/v1/admin/agents/receiver/test', 'new_work'],
      ['POST', '/v1/conversations/thread-id/messages', 'new_work'], ['POST', '/v1/admin/schedules', 'new_work'],
      ['POST', '/v1/admin/tick', 'new_work'], ['get', '/v1/agents', 'read'],
      ['POST', '/v1/unknown', 'mutation'],
    ]) assert.equal(api.resourceOperationForHttp(method, path), operation, `${method} ${path}`);
  });

  await check('owner control admission explicitly includes inspection and existing recovery routes', async () => {
    for (const path of ['/v1/types', '/v1/me', '/v1/configuration', '/v1/workspace/release', '/v1/conversations',
      '/v1/jobs', '/v1/events', '/v1/admin/overview', '/v1/admin/agents', '/v1/admin/schedules',
      '/v1/admin/workspace', '/v1/admin/export', '/v1/agents/agent-id/collaboration', '/v1/agents/agent-id/activation',
      '/v1/requests/request-id/activation', '/v1/admin/agents/agent-id/setup', '/v1/jobs/job-id', '/v1/conversations/thread-id']) {
      for (const method of ['GET', 'HEAD']) assert.equal(api.isOwnerResourceControlRoute(method, path), true, `${method} ${path}`);
    }
    for (const [method, path] of [['DELETE', '/v1/admin/workspace'], ['DELETE', '/v1/admin/agents/agent-id'],
      ['DELETE', '/v1/admin/schedules/schedule-id'], ['DELETE', '/v1/agents/agent-id/activation'],
      ['PATCH', '/v1/admin/workspace'], ['POST', '/v1/admin/agents'], ['POST', '/v1/jobs/job-id/cancel'],
      ['PUT', '/v1/agents/agent-id/collaboration'], ['PATCH', '/v1/agents/agent-id/onboarding'],
      ['POST', '/v1/admin/agents/agent-id/setup'], ['POST', '/v1/admin/agents/agent-id/pairing'],
      ['PUT', '/v1/workspace/release'],
      ['POST', '/v1/conversations/thread-id/stop']]) {
      assert.equal(api.isOwnerResourceControlRoute(method, path), true, `${method} ${path}`);
    }
  });

  await check('owner control admission excludes every polling, claim and new-work route, including HEAD and unknown routes', async () => {
    for (const path of ['/v1/work/next', '/v1/inbox', '/v1/conversations/inbox', '/v1/requests/pending']) {
      for (const method of ['GET', 'HEAD', 'POST']) assert.equal(api.isOwnerResourceControlRoute(method, path), false, `${method} ${path}`);
    }
    for (const path of ['/v1/jobs', '/v1/conversations', '/v1/conversations/thread-id/messages', '/v1/conversations/thread-id/extend',
      '/v1/jobs/job-id/approve', '/v1/jobs/job-id/reply', '/v1/jobs/job-id/reject', '/v1/requests/request-id/claim',
      '/v1/admin/agents/agent-id/test', '/v1/admin/schedules', '/v1/admin/tick', '/v1/submit']) {
      assert.equal(api.isOwnerResourceControlRoute('POST', path), false, path);
    }
    for (const [method, path] of [['GET', '/v1/new-endpoint'], ['GET', '/v1/admin/tick'],
      ['DELETE', '/v1/new-endpoint'], ['PUT', '/v1/agents/agent-id/activation'], ['POST', '/v1/new-endpoint/stop'],
      ['PATCH', '/v1/agents/agent-id/collaboration'], ['PUT', '/v1/admin/agents/agent-id/setup'],
      ['POST', '/v1/workspace/release']]) {
      assert.equal(api.isOwnerResourceControlRoute(method, path), false, `${method} ${path}`);
    }
  });

  const ownerActor = { owner: true, agent: null };
  const laneEnv = {
    ...env,
    RESOURCE_ANONYMOUS_DAILY_OPERATIONS: '100', RESOURCE_ANONYMOUS_MONTHLY_OPERATIONS: '1000',
    RESOURCE_OWNER_GLOBAL_DAILY_OPERATIONS: '100', RESOURCE_OWNER_GLOBAL_MONTHLY_OPERATIONS: '1000',
    RESOURCE_OWNER_WORKSPACE_DAILY_OPERATIONS: '100', RESOURCE_OWNER_WORKSPACE_MONTHLY_OPERATIONS: '1000',
    RESOURCE_MAINTENANCE_DAILY_OPERATIONS: '100', RESOURCE_MAINTENANCE_MONTHLY_OPERATIONS: '1000',
  };
  const laneRows = () => sqlite.prepare('SELECT * FROM resource_lane_budgets ORDER BY lane,scope_type,scope_id').all();
  const laneRow = (lane, scope = 'global', id = 'service') => sqlite.prepare('SELECT * FROM resource_lane_budgets WHERE lane=? AND scope_type=? AND scope_id=?').get(lane, scope, id);
  const resetLanes = () => { reset(); sqlite.exec('DELETE FROM resource_lane_budgets'); };

  await check('anonymous exhaustion leaves tenant, owner and maintenance capacity independent', async () => {
    resetLanes();
    const settings = { ...laneEnv, RESOURCE_ANONYMOUS_DAILY_OPERATIONS: '1' };
    const admitted = await api.admitAnonymousResourceOperation(settings, now);
    assert.equal(admitted.allowed, true); assert.equal(admitted.cost, 1); assert.equal(admitted.lane, 'anonymous');
    const before = totalChanges(), snapshot = laneRows();
    for (let i = 0; i < 8; i++) {
      const rejected = await api.admitAnonymousResourceOperation(settings, now);
      assert.equal(rejected.allowed, false); assert.equal(rejected.reason, 'anonymous_budget_exhausted');
    }
    assert.equal(totalChanges(), before); assert.deepEqual(laneRows(), snapshot); assert.deepEqual(rows(), []);
    assert.equal((await api.admitResourceOperation(settings, 'weighted', 'read', now)).allowed, true);
    const owner = await api.admitOwnerResourceOperation(settings, 'weighted', ownerActor, 'read', now);
    assert.equal(owner.allowed, true); assert.equal(owner.lane, 'owner');
    const maintenance = await api.admitMaintenanceResourceOperation(settings, { cost: 20 }, now);
    assert.equal(maintenance.allowed, true); assert.equal(maintenance.lane, 'maintenance');
    assert.equal(laneRow('anonymous').day_used, 1);
    assert.equal(laneRow('owner').day_used, 1); assert.equal(laneRow('owner', 'workspace', 'weighted').day_used, 1);
    assert.equal(laneRow('maintenance').day_used, 20); assert.equal(row('global', 'service').day_used, 1);
  });

  await check('exhausted agent work still permits owner recovery and maintenance', async () => {
    resetLanes();
    const settings = { ...laneEnv, RESOURCE_GLOBAL_DAILY_OPERATIONS: '1', RESOURCE_WORKSPACE_DAILY_OPERATIONS: '1' };
    await api.assertResourceOperation(settings, 'weighted', 'read', now);
    assert.equal((await api.admitResourceOperation(settings, 'weighted', 'read', now)).allowed, false);
    const snapshot = rows();
    await api.assertOwnerResourceOperation(settings, 'weighted', ownerActor, 'export', now);
    await api.assertOwnerResourceOperation(settings, 'weighted', ownerActor, 'cancel', now);
    await api.assertMaintenanceResourceOperation(settings, { cost: 20 }, now);
    assert.deepEqual(rows(), snapshot, 'Recovery lanes must not debit exhausted work counters');
    assert.equal(laneRow('owner').day_used, 60); assert.equal(laneRow('maintenance').day_used, 20);
  });

  await check('anonymous and maintenance daily and monthly caps are independently enforced', async () => {
    for (const [lane, prefix, admit, assertAdmission] of [
      ['anonymous', 'RESOURCE_ANONYMOUS', (settings) => api.admitAnonymousResourceOperation(settings, now), (settings) => api.assertAnonymousResourceOperation(settings, now)],
      ['maintenance', 'RESOURCE_MAINTENANCE', (settings) => api.admitMaintenanceResourceOperation(settings, { cost: 1 }, now), (settings) => api.assertMaintenanceResourceOperation(settings, { cost: 1 }, now)],
    ]) {
      for (const period of ['DAILY', 'MONTHLY']) {
        resetLanes();
        const settings = { ...laneEnv, [`${prefix}_${period}_OPERATIONS`]: '1' };
        await assertAdmission(settings);
        const before = totalChanges(), snapshot = laneRows();
        const rejected = await admit(settings);
        assert.equal(rejected.allowed, false); assert.equal(rejected.reason, `${lane}_budget_exhausted`);
        assert.ok(rejected.retryAfterSeconds > 0);
        await assert.rejects(() => assertAdmission(settings), (error) => {
          assert.ok(error instanceof api.ResourceBudgetError); assert.equal(error.status, 429);
          assert.equal(error.code, `${lane}_budget_exhausted`); return true;
        });
        assert.equal(totalChanges(), before); assert.deepEqual(laneRows(), snapshot); assert.deepEqual(rows(), []);
      }
    }
  });

  await check('owner control requires a human owner and cannot admit new work', async () => {
    resetLanes();
    const before = totalChanges();
    for (const actor of [{ owner: false, agent: null }, { owner: false, agent: { id: 'worker' } }, { owner: true, agent: { id: 'worker' } }]) {
      const rejected = await api.admitOwnerResourceOperation(laneEnv, 'weighted', actor, 'read', now);
      assert.equal(rejected.allowed, false); assert.equal(rejected.reason, 'owner_control_required');
    }
    for (const operation of ['new_work', { cost: 1, newWork: true }]) {
      await assert.rejects(() => api.assertOwnerResourceOperation(laneEnv, 'weighted', ownerActor, operation, now), (error) => {
        assert.ok(error instanceof api.ResourceBudgetError); assert.equal(error.status, 403);
        assert.equal(error.code, 'owner_control_required'); return true;
      });
    }
    assert.equal(totalChanges(), before); assert.deepEqual(laneRows(), []); assert.deepEqual(rows(), []);
  });

  await check('each owner scope and period rejects without charging either owner counter', async () => {
    for (const [setting, scope] of [
      ['RESOURCE_OWNER_GLOBAL_DAILY_OPERATIONS', 'global'], ['RESOURCE_OWNER_GLOBAL_MONTHLY_OPERATIONS', 'global'],
      ['RESOURCE_OWNER_WORKSPACE_DAILY_OPERATIONS', 'workspace'], ['RESOURCE_OWNER_WORKSPACE_MONTHLY_OPERATIONS', 'workspace'],
    ]) {
      resetLanes();
      const settings = { ...laneEnv, [setting]: '1' };
      await api.assertOwnerResourceOperation(settings, 'weighted', ownerActor, 'read', now);
      const before = totalChanges(), snapshot = laneRows();
      const rejected = await api.admitOwnerResourceOperation(settings, 'weighted', ownerActor, 'read', now);
      assert.equal(rejected.allowed, false); assert.equal(rejected.reason, `owner_${scope}_budget_exhausted`);
      assert.equal(totalChanges(), before); assert.deepEqual(laneRows(), snapshot);
      await api.assertMaintenanceResourceOperation(settings, { cost: 1 }, now);
      assert.deepEqual(laneRows().filter((item) => item.lane === 'owner'), snapshot);
    }
    resetLanes();
    const before = totalChanges();
    assert.equal((await api.admitOwnerResourceOperation({ ...laneEnv, RESOURCE_OWNER_WORKSPACE_DAILY_OPERATIONS: '0' }, 'weighted', ownerActor, 'read', now)).allowed, false);
    assert.equal(totalChanges(), before); assert.deepEqual(laneRows(), []);
  });

  await check('concurrent owner requests compete atomically for the final global or workspace slot', async () => {
    for (const scope of ['global', 'workspace']) {
      resetLanes();
      const settings = { ...laneEnv, [scope === 'global' ? 'RESOURCE_OWNER_GLOBAL_DAILY_OPERATIONS' : 'RESOURCE_OWNER_WORKSPACE_DAILY_OPERATIONS']: '2' };
      await api.assertOwnerResourceOperation(settings, 'weighted', ownerActor, 'read', now);
      const results = await Promise.all(Array.from({ length: 32 }, (_, index) => api.admitOwnerResourceOperation(settings,
        scope === 'global' ? `global-race-${index}` : 'weighted', ownerActor, 'read', now)));
      assert.equal(results.filter((result) => result.allowed).length, 1, scope);
      assert.equal(laneRow('owner').day_used, 2); assert.equal(laneRow('owner').month_used, 2);
      const workspaceRows = laneRows().filter((item) => item.scope_type === 'workspace');
      assert.equal(workspaceRows.reduce((sum, item) => sum + item.day_used, 0), 2);
      assert.equal(workspaceRows.length, scope === 'global' ? 2 : 1, 'Rejected requests cannot create empty owner rows');
      const before = totalChanges(), snapshot = laneRows();
      assert.equal((await api.admitOwnerResourceOperation(settings, 'weighted', ownerActor, 'read', now)).allowed, false);
      assert.equal(totalChanges(), before); assert.deepEqual(laneRows(), snapshot);
    }
  });

  await check('owner SQL failure leaves both owner scopes unchanged', async () => {
    resetLanes();
    await api.assertOwnerResourceOperation(laneEnv, 'weighted', ownerActor, 'read', now);
    const snapshot = laneRows();
    sqlite.exec(`CREATE TEMP TRIGGER fail_owner_budget BEFORE UPDATE ON resource_lane_budgets
      WHEN NEW.lane='owner' AND NEW.scope_type='workspace' BEGIN SELECT RAISE(ABORT,'Synthetic owner counter failure'); END`);
    try {
      const rejected = await api.admitOwnerResourceOperation(laneEnv, 'weighted', ownerActor, 'read', now);
      assert.equal(rejected.allowed, false); assert.equal(rejected.reason, 'resource_budget_unavailable');
      assert.deepEqual(laneRows(), snapshot);
    } finally { sqlite.exec('DROP TRIGGER fail_owner_budget'); }
  });

  await check('independent lanes roll over UTC periods without growing history rows', async () => {
    resetLanes();
    const admitAll = async (at) => {
      await api.assertAnonymousResourceOperation(laneEnv, at);
      await api.assertOwnerResourceOperation(laneEnv, 'weighted', ownerActor, 'read', at);
      await api.assertMaintenanceResourceOperation(laneEnv, { cost: 3 }, at);
    };
    await admitAll(now);
    await admitAll(Date.parse('2026-01-31T00:00:00Z'));
    for (const entry of laneRows()) {
      assert.equal(entry.day_key, '2026-01-31'); assert.equal(entry.month_key, '2026-01');
      assert.equal(entry.day_used, entry.lane === 'maintenance' ? 3 : 1);
      assert.equal(entry.month_used, entry.lane === 'maintenance' ? 6 : 2);
    }
    await admitAll(Date.parse('2026-02-01T00:00:00Z'));
    for (const entry of laneRows()) assert.equal(entry.month_used, entry.lane === 'maintenance' ? 3 : 1);
    const before = totalChanges(), snapshot = laneRows();
    for (const rejected of [
      await api.admitAnonymousResourceOperation(laneEnv, now),
      await api.admitOwnerResourceOperation(laneEnv, 'weighted', ownerActor, 'read', now),
      await api.admitMaintenanceResourceOperation(laneEnv, { cost: 1 }, now),
    ]) { assert.equal(rejected.allowed, false); assert.equal(rejected.reason, 'resource_budget_unavailable'); }
    assert.equal(totalChanges(), before); assert.deepEqual(laneRows(), snapshot);
    for (let month = 2; month < 14; month++) {
      await admitAll(Date.UTC(2026, month, 1));
      assert.equal(laneRows().length, 4);
      for (const entry of laneRows()) assert.equal(entry.month_used, entry.lane === 'maintenance' ? 3 : 1);
    }
  });

  await check('owner control status reads only owner capacity and does not write current or stale periods', async () => {
    resetLanes();
    let before = totalChanges();
    const empty = await api.resourceControlBudgetStatus(laneEnv, 'weighted', now);
    assert.equal(empty.enabled, true); assert.equal(empty.global.day.used, 0); assert.equal(empty.workspace.day.used, 0);
    assert.equal(empty.workspace.day.limit, 100); assert.equal(totalChanges(), before); assert.deepEqual(laneRows(), []);
    await api.assertResourceOperation(laneEnv, 'weighted', 'mutation', now);
    await api.assertOwnerResourceOperation(laneEnv, 'weighted', ownerActor, 'read', now);
    const snapshot = laneRows(); before = totalChanges();
    const current = await api.resourceControlBudgetStatus(laneEnv, 'weighted', now);
    assert.equal(current.global.day.used, 1); assert.equal(current.workspace.day.used, 1);
    const nextMonth = await api.resourceControlBudgetStatus(laneEnv, 'weighted', Date.parse('2026-02-01T00:00:00Z'));
    assert.equal(nextMonth.global.month.used, 0); assert.equal(nextMonth.workspace.month.used, 0);
    assert.equal(totalChanges(), before); assert.deepEqual(laneRows(), snapshot);
  });

  await check('workspace deletion removes its owner counter while retaining service lanes', async () => {
    resetLanes();
    sqlite.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)').run('lane-delete', 'Lane deletion fixture', now);
    await api.assertOwnerResourceOperation(laneEnv, 'lane-delete', ownerActor, 'read', now);
    await api.assertAnonymousResourceOperation(laneEnv, now);
    await api.assertMaintenanceResourceOperation(laneEnv, { cost: 1 }, now);
    const serviceRows = laneRows().filter((entry) => entry.scope_type === 'global');
    sqlite.prepare('DELETE FROM workspaces WHERE id=?').run('lane-delete');
    assert.equal(laneRow('owner', 'workspace', 'lane-delete'), undefined);
    assert.deepEqual(laneRows(), serviceRows);
    const before = totalChanges();
    const rejected = await api.admitOwnerResourceOperation(laneEnv, 'lane-delete', ownerActor, 'read', now);
    assert.equal(rejected.allowed, false); assert.equal(rejected.reason, 'resource_budget_unavailable');
    assert.equal(totalChanges(), before); assert.deepEqual(laneRows(), serviceRows);
  });

  await check('missing lane storage fails closed and disabled self-hosting never accesses it', async () => {
    const missing = new DatabaseSync(':memory:');
    try {
      const settings = { ...laneEnv, DB: d1(missing) };
      for (const admit of [
        () => api.admitAnonymousResourceOperation(settings, now),
        () => api.admitOwnerResourceOperation(settings, 'weighted', ownerActor, 'read', now),
        () => api.admitMaintenanceResourceOperation(settings, { cost: 1 }, now),
      ]) {
        const result = await admit(); assert.equal(result.allowed, false); assert.equal(result.enabled, true);
        assert.equal(result.reason, 'resource_budget_unavailable');
      }
      for (const assertAdmission of [
        () => api.assertAnonymousResourceOperation(settings, now),
        () => api.assertOwnerResourceOperation(settings, 'weighted', ownerActor, 'read', now),
        () => api.assertMaintenanceResourceOperation(settings, { cost: 1 }, now),
      ]) await assert.rejects(assertAdmission, (error) => {
        assert.ok(error instanceof api.ResourceBudgetError); assert.equal(error.status, 503);
        assert.equal(error.code, 'resource_budget_unavailable'); return true;
      });
      assert.equal(missing.prepare('SELECT total_changes() AS n').get().n, 0);
    } finally { missing.close(); }
    const inaccessible = { prepare() { throw new Error('Disabled lanes must not touch DB'); }, batch() { throw new Error('Disabled lanes must not touch DB'); } };
    const selfhost = { DB: inaccessible, HOSTED: 'false', RESOURCE_BUDGETS_ENABLED: 'false' };
    for (const result of [
      await api.assertAnonymousResourceOperation(selfhost, now),
      await api.assertOwnerResourceOperation(selfhost, 'weighted', ownerActor, 'read', now),
      await api.assertMaintenanceResourceOperation(selfhost, { cost: 1 }, now),
    ]) { assert.equal(result.allowed, true); assert.equal(result.enabled, false); }
    await assert.rejects(() => api.assertOwnerResourceOperation(selfhost, 'weighted', { owner: false, agent: { id: 'worker' } }, 'read', now), (error) => {
      assert.equal(error.status, 403); assert.equal(error.code, 'owner_control_required'); return true;
    });
    assert.equal((await api.resourceControlBudgetStatus(selfhost, 'weighted', now)).enabled, false);
  });

  console.log(`PASS ${checks} resource budget checks`);
} finally {
  sqlite.close();
  await rm(temporary, { recursive: true, force: true });
}
