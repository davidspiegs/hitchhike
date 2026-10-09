/** Atomic requeue routing tests on migrated SQLite; all network use forbidden. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-transition-permissions-'));
const sqlite = new DatabaseSync(':memory:');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Transition tests must not contact external services.'); };
const now = 1_800_000_000_000;
const owner = { owner: true, agent: null };
let beforeBatch, checks = 0;
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() { return { results: [], meta: sqlite.prepare(this.sql).run(...this.values), success: true }; }
}
const DB = { prepare: sql => new Statement(sql), async batch(statements) {
  if (beforeBatch) { const hook = beforeBatch; beforeBatch = undefined; hook(statements); }
  sqlite.exec('BEGIN');
  try {
    const result = statements.map(s => {
      const stmt = sqlite.prepare(s.sql);
      return stmt.columns().length ? { results: stmt.all(...s.values), meta: sqlite.prepare('SELECT changes() changes').get(), success: true }
        : { results: [], meta: stmt.run(...s.values), success: true };
    });
    sqlite.exec('COMMIT'); return result;
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
} };
const env = { DB, HOSTED: 'true', MIN_LEASE_SECONDS: '1' };
const agent = id => sqlite.prepare('SELECT * FROM agents WHERE id=?').get(id);
const job = id => sqlite.prepare('SELECT * FROM jobs WHERE id=?').get(id);
const check = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
let api;
async function fixture(action, { broadcast = false, strict = false } = {}) {
  beforeBatch = undefined;
  for (const table of ['wake_deliveries', 'claims', 'events', 'jobs', 'conversation_messages', 'conversation_receipts', 'conversations', 'conversation_chains', 'agent_collaboration', 'agents']) sqlite.exec(`DELETE FROM ${table}`);
  sqlite.exec("UPDATE workspaces SET paused=0,next_release_beta=1,security_suspended=0,identity_restricted=0,storage_limit_bytes=10485760 WHERE id='default'");
  for (const id of ['sender', 'worker', 'spare']) sqlite.prepare(`INSERT INTO agents(id,handle,name,token_hash,can_request,can_work,work_types,created_at)
    VALUES (?,?,?,?,?,?,'["task"]',?)`).run(id, id, id, 'synthetic-' + id, id === 'sender' ? 1 : 0, id === 'sender' ? 0 : 1, now);
  const actor = { owner: false, agent: agent('sender') };
  const row = strict ? (await api.sendMessage(env, actor, { to: 'worker', message: 'Investigate the fixture.' }, now)).request
    : (await api.createJob(env, 'sender', actor.agent, { type: 'task', to: broadcast ? '*' : 'worker', title: 'Routing fixture', goal: 'Investigate.', max_attempts: 3 }, undefined, now)).row;
  const claim = await api.claimNext(env, agent('worker'), now, undefined, row.id, strict ? 'execution-1' : undefined);
  assert.equal(claim.job.id, row.id);
  const submission = action === 'reply' ? { status: 'needs_input', question: 'Which option?' } : { summary: 'The completed answer.' };
  await api.submitResult(env, claim.token, submission, [], now);
  return { id: row.id, actor };
}
async function blockedAfterLookup(action, mutate, settings = {}) {
  const { id, actor } = await fixture(action, settings);
  const before = job(id), events = sqlite.prepare('SELECT COUNT(*) n FROM events').get().n;
  let raced = false;
  beforeBatch = statements => {
    assert.match(statements[0].sql, /UPDATE jobs SET status='queued'/);
    mutate(); raced = true;
  };
  await assert.rejects(api.transition(env, actor, id, action, 'Updated guidance.', now + 1), error => error.status === 409);
  assert.equal(raced, true, 'Mutation must occur after authentication and permission reads');
  assert.deepEqual(job(id), before, 'Rejected requeue preserves result, thread and work generation');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM events').get().n, events);
  return { id, actor };
}
function policy(id, change) {
  const settings = { ...api.defaultCollaborationSettings(agent(id)), ...change };
  sqlite.prepare('INSERT INTO agent_collaboration(workspace_id,agent_id,settings,updated_at) VALUES (?,?,?,?)')
    .run('default', id, JSON.stringify(settings), now);
}
try {
  for (const migration of (await readdir(join(root, 'migrations'))).filter(file => file.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(root, 'migrations', migration), 'utf8'));
  const output = join(temporary, 'api.mjs');
  await build({ stdin: { contents: "export * from './src/store'; export { sendMessage } from './src/conversations'; export { defaultCollaborationSettings } from './src/collaboration';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'silent' });
  api = await import(pathToFileURL(output).href);

  await check('reply and reject atomically honor target removal after the sender permission lookup', async () => {
    for (const action of ['reply', 'reject']) await blockedAfterLookup(action, () => sqlite.exec("UPDATE agents SET request_targets='[\"spare\"]' WHERE id='sender'"));
  });
  await check('current recipient acceptance, receive role and categories fence both requeue actions', async () => {
    for (const action of ['reply', 'reject']) for (const change of ["accept_from='[]'", 'can_work=0', "work_types='[]'"]) {
      await blockedAfterLookup(action, () => sqlite.exec(`UPDATE agents SET ${change} WHERE id='worker'`));
    }
  });
  await check('strict conversations recheck both collaborators and category policies at the write', async () => {
    for (const action of ['reply', 'reject']) for (const [id, change] of [
      ['sender', { permitted_collaborators: ['spare'] }], ['sender', { allowed_request_categories: [] }],
      ['worker', { permitted_collaborators: ['spare'] }], ['worker', { allowed_work_categories: [] }],
    ]) await blockedAfterLookup(action, () => policy(id, change), { strict: true });
  });
  await check('normal directed requeues remain available with exact permitted targets', async () => {
    for (const action of ['reply', 'reject']) {
      const { id, actor } = await fixture(action);
      sqlite.exec("UPDATE agents SET request_targets='[\"worker\"]' WHERE id='sender'; UPDATE agents SET accept_from='[\"sender\"]' WHERE id='worker'");
      assert.equal((await api.transition(env, actor, id, action, 'Continue.', now + 1)).status, 'queued');
    }
  });
  await check('broadcast requeues require wildcard send permission and the actual previous worker acceptance', async () => {
    for (const action of ['reply', 'reject']) {
      await blockedAfterLookup(action, () => sqlite.exec("UPDATE agents SET request_targets='[\"worker\"]' WHERE id='sender'"), { broadcast: true });
      await blockedAfterLookup(action, () => sqlite.exec("UPDATE agents SET accept_from='[]' WHERE id='worker'"), { broadcast: true });
      const { id, actor } = await fixture(action, { broadcast: true });
      assert.equal((await api.transition(env, actor, id, action, 'Continue.', now + 1)).status, 'queued');
      assert.equal(job(id).to_agent, '*');
    }
  });
  await check('broadcast clarification identifies its worker after old claim receipts are pruned', async () => {
    const { id, actor } = await fixture('reply', { broadcast: true }); sqlite.exec('DELETE FROM claims');
    assert.equal((await api.transition(env, actor, id, 'reply', 'Continue.', now + 1)).status, 'queued');
  });
  await check('owner control remains available after routing permission removal', async () => {
    for (const action of ['reply', 'reject']) {
      const { id } = await blockedAfterLookup(action, () => sqlite.exec("UPDATE agents SET request_targets='[]' WHERE id='sender'"));
      assert.equal((await api.transition(env, owner, id, action, 'Owner-authorized continuation.', now + 2)).status, 'queued');
    }
  });
  await check('target removal still permits cancellation and acceptance without requeueing work', async () => {
    const waiting = await fixture('reply'); sqlite.exec("UPDATE agents SET request_targets='[]' WHERE id='sender'");
    assert.equal((await api.transition(env, waiting.actor, waiting.id, 'cancel', undefined, now + 1)).status, 'canceled');
    const completed = await fixture('reject'); sqlite.exec("UPDATE agents SET request_targets='[]' WHERE id='sender'");
    assert.equal((await api.transition(env, completed.actor, completed.id, 'accept', undefined, now + 1)).status, 'completed');
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM events WHERE kind='accepted'").get().n, 1);
  });
  console.log(`\n${checks} transition permission checks passed; no network requests.`);
} finally { globalThis.fetch = originalFetch; sqlite.close(); await rm(temporary, { recursive: true, force: true }); }
