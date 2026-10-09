/** Real migrated SQLite: metadata quotas, atomic cascades, and durable consumers. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'hitchhike-storage-'));
const migrations = (await readdir(join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort();
const sql = new Map(await Promise.all(migrations.map(async f => [f, await readFile(join(root, 'migrations', f), 'utf8')])));
const sqlite = new DatabaseSync(':memory:');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Storage tests must not contact external services.'); };
let checks = 0;
const now = Date.now();
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() { return { meta: sqlite.prepare(this.sql).run(...this.values), success: true }; }
}
const DB = { prepare: sql => new Statement(sql), async batch(statements) {
  sqlite.exec('BEGIN');
  try {
    const result = statements.map(s => { const q = sqlite.prepare(s.sql); return q.columns().length
      ? { results: q.all(...s.values), meta: sqlite.prepare('SELECT changes() changes').get(), success: true }
      : { results: [], meta: q.run(...s.values), success: true }; });
    sqlite.exec('COMMIT'); return result;
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
} };
const env = { DB, HOSTED: 'true', WORKSPACE_ID: 'tenant' };
const usage = (id = 'tenant', db = sqlite) => db.prepare('SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=?').get(id)?.accounted_bytes ?? 0;
const accountedTables = ['workspaces', 'users', 'agents', 'jobs', 'claims', 'events', 'schedules', 'oauth_grants', 'pairing_codes',
  'wake_deliveries', 'conversation_chains', 'conversations', 'conversation_messages', 'conversation_receipts', 'agent_collaboration',
  'agent_onboarding', 'collaboration_background_runs', 'activation_configs', 'activation_dispatches', 'activation_launch_attempts'];
const reservedColumns = new Set(['title', 'status', 'lease_holder', 'lease_id', 'claim_consumer', 'result_by', 'error', 'last_error',
  'disabled_reason', 'attempt_token', 'lease_token', 'error_code', 'provider_session_id', 'provider_session_url', 'reservation_nonce',
  'step', 'token_ciphertext', 'key_ciphertext', 'token_hash', 'identity_hash']);
// Independently reconcile every text column, including future schema additions.
// Do not reproduce the migration's SQL or depend on a large diagnostic UNION:
// D1 deliberately has a smaller compound-SELECT limit than desktop SQLite.
const totals = db => {
  const workspaces = new Map();
  for (const table of accountedTables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().filter(c => c.type === 'TEXT').map(c => c.name);
    for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
      const workspace = table === 'workspaces' ? row.id : row.workspace_id;
      const bytes = 1024 + 2 * columns.reduce((total, column) => total + Math.max(reservedColumns.has(column) ? 512 : 0,
        row[column] == null ? 0 : Buffer.byteLength(String(row[column]))), 0);
      workspaces.set(workspace, (workspaces.get(workspace) ?? 0) + bytes);
    }
  }
  return [...workspaces].sort(([a], [b]) => a.localeCompare(b)).map(([workspace_id, accounted_bytes]) => ({ workspace_id, accounted_bytes }));
};
const reconciles = (db = sqlite) => assert.deepEqual(db.prepare('SELECT * FROM workspace_storage_usage WHERE accounted_bytes>0 ORDER BY workspace_id').all().map(r => ({ ...r })), totals(db));
const check = async (label, fn) => { await fn(); reconciles(); console.log(`ok ${++checks} - ${label}`); };
function workspace(id = 'tenant', db = sqlite, limit = 10 * 1024 * 1024) {
  db.prepare('INSERT INTO workspaces(id,name,created_at,storage_limit_bytes) VALUES(?,?,?,?)').run(id, id, now, limit);
}
function agent(id, db = sqlite, ws = 'tenant') {
  db.prepare(`INSERT INTO agents(id,workspace_id,handle,name,token_hash,can_request,can_work,work_types,created_at)
    VALUES(?,?,?,?,?,1,1,'["task"]',?)`).run(id, ws, id, id, `synthetic-${id}`, now);
  return db.prepare('SELECT * FROM agents WHERE id=?').get(id);
}
function conversation(id = 'conversation', db = sqlite, ws = 'tenant') {
  db.prepare('INSERT INTO conversation_chains(workspace_id,root_id) VALUES(?,?)').run(ws, id);
  db.prepare(`INSERT INTO conversations(workspace_id,id,title,participants,chain_root_id,created_at,last_message_at)
    VALUES(?,?,?,'["sender","worker"]',?,?,?)`).run(ws, id, id, id, now, now);
  db.prepare(`INSERT INTO conversation_messages(workspace_id,conversation_id,from_agent,to_agent,kind,text,source_key,created_at)
    VALUES(?,?,'sender','worker','note','An unread message',?,?)`).run(ws, id, `message-${id}`, now);
  return db.prepare('SELECT MAX(id) id FROM conversation_messages WHERE workspace_id=? AND conversation_id=?').get(ws, id).id;
}
function job(id, title = 'Small task', db = sqlite, ws = 'tenant') {
  db.prepare(`INSERT INTO jobs(id,workspace_id,v,type,from_agent,to_agent,title,spec,status,lease_seconds,created_at,updated_at)
    VALUES(?,?,'1','task','sender','worker',?,'{"goal":"A task"}','queued',60,?,?)`).run(id, ws, title, now, now);
}
function quota(extra = 0, id = 'tenant') {
  sqlite.prepare('UPDATE workspaces SET storage_limit_bytes=? WHERE id=?').run(usage(id) + extra, id);
}
const unlimited = () => sqlite.prepare('UPDATE workspaces SET storage_limit_bytes=? WHERE id=?').run(10 * 1024 * 1024, 'tenant');

try {
  for (const source of sql.values()) sqlite.exec(source);
  await build({ stdin: { contents: "export * from './src/conversations'; export * from './src/storage-accounting'; export { submitResult } from './src/store';", resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile: join(temp, 'api.mjs'), logLevel: 'silent' });
  const api = await import(pathToFileURL(join(temp, 'api.mjs')).href);
  workspace(); agent('sender'); const worker = agent('worker');
  const cursor = conversation();

  await check('fresh migrations expose conservative accounted usage including workspace and connection metadata', async () => {
    assert.ok(usage() > 5 * 1024);
    assert.equal(await api.getAccountedStorage(env), usage());
    assert.equal(await api.getAccountedStorage(env, 'unknown'), 0);
    const tables = accountedTables.filter(table => sqlite.prepare(`SELECT 1 FROM ${table} WHERE ${table === 'workspaces' ? 'id' : 'workspace_id'}=? LIMIT 1`).get('tenant'));
    assert.ok(tables.includes('agents')); assert.ok(tables.includes('conversations')); assert.ok(tables.includes('workspaces'));
  });
  await check('standard hosted storage upgrades to thirty-two MiB while custom and self-hosted caps stay unchanged', async () => {
    const upgrade = new DatabaseSync(':memory:');
    try {
      for (const [file, source] of sql) if (file < '0021') upgrade.exec(source);
      workspace('standard', upgrade, 10 * 1024 * 1024);
      workspace('custom-small', upgrade, 1024 * 1024);
      workspace('custom-large', upgrade, 64 * 1024 * 1024);
      const originalDefault = upgrade.prepare("SELECT storage_limit_bytes FROM workspaces WHERE id='default'").get().storage_limit_bytes;
      const originalUsage = upgrade.prepare('SELECT * FROM workspace_storage_usage ORDER BY workspace_id').all();
      for (const [file, source] of sql) if (file >= '0021') upgrade.exec(source);
      const limit = id => upgrade.prepare('SELECT storage_limit_bytes FROM workspaces WHERE id=?').get(id).storage_limit_bytes;
      assert.equal(limit('standard'), api.DEFAULT_HOSTED_STORAGE_LIMIT_BYTES);
      assert.equal(limit('standard'), 33554432);
      assert.equal(limit('custom-small'), 1024 * 1024);
      assert.equal(limit('custom-large'), 64 * 1024 * 1024);
      assert.equal(limit('default'), originalDefault);
      assert.equal(api.SHARED_ACCOUNTED_STORAGE_LIMIT_BYTES, 1610612736);
      assert.deepEqual(upgrade.prepare('SELECT * FROM workspace_storage_usage ORDER BY workspace_id').all(), originalUsage);
      reconciles(upgrade);
    } finally { upgrade.close(); }
  });
  await check('workspace auth, delivery and collaboration metadata cannot grow outside the shared ledger', async () => {
    workspace('metadata'); agent('metadata-agent', sqlite, 'metadata');
    job('old-job', 'Metadata fixture', sqlite, 'metadata');
    sqlite.exec(`
      INSERT INTO users(id,google_sub,email,name,workspace_id,created_at) VALUES('metadata-user','metadata-sub','test@example.test','Test','metadata',1);
      INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES('metadata-client','Test','[]',1);
      INSERT INTO oauth_grants(id,user_id,workspace_id,agent_id,auth_generation,client_id,scope,resource,created_at)
        VALUES('metadata-grant','metadata-user','metadata','metadata-agent',1,'metadata-client','relay:read','https://relay.example.test',1);
      INSERT INTO claims(token_hash,job_id,agent_id,attempt,issued_at,workspace_id) VALUES('metadata-claim','old-job','metadata-agent',1,1,'metadata');
      INSERT INTO pairing_codes(code_hash,workspace_id,agent_id,auth_generation,created_at,expires_at) VALUES('metadata-pair','metadata','metadata-agent',1,1,2);
      INSERT INTO wake_deliveries(workspace_id,job_id,agent_id,generation,next_attempt_at,created_at,updated_at) VALUES('metadata','old-job','metadata-agent',1,1,1,1);
      INSERT INTO agent_collaboration(workspace_id,agent_id,settings,updated_at) VALUES('metadata','metadata-agent','{}',1);
      INSERT INTO agent_onboarding(workspace_id,agent_id,provider,surface,updated_at) VALUES('metadata','metadata-agent','other','api',1);
      INSERT INTO collaboration_background_runs(workspace_id,agent_id,run_id,method,request_id,observed_at) VALUES('metadata','metadata-agent','metadata-run','scheduled','old-job',1);
      INSERT INTO activation_configs(workspace_id,agent_id,endpoint,created_at,updated_at) VALUES('metadata','metadata-agent','https://api.anthropic.com/fixture',1,1);
      INSERT INTO activation_dispatches(id,workspace_id,job_id,agent_id,generation,config_revision,status,next_attempt_at,created_at,updated_at)
        VALUES('metadata-dispatch','metadata','old-job','metadata-agent','1',1,'pending',1,1,1);
      INSERT INTO activation_launch_attempts(dispatch_id,attempt,reservation_nonce,workspace_id,agent_id,job_id,admitted_at)
        VALUES('metadata-evidence',1,'metadata-nonce','metadata','metadata-agent','old-job',1);
    `);
    const columns = { users: 'name', oauth_grants: 'resource', claims: 'token_hash', pairing_codes: 'code_hash',
      wake_deliveries: 'last_error', agent_collaboration: 'settings', agent_onboarding: 'surface',
      collaboration_background_runs: 'run_id', activation_configs: 'token_ciphertext', activation_dispatches: 'provider_session_url',
      activation_launch_attempts: 'reservation_nonce' };
    const before = usage('metadata'); quota(0, 'metadata');
    for (const [table, column] of Object.entries(columns)) {
      assert.throws(() => sqlite.prepare(`UPDATE ${table} SET ${column}=? WHERE workspace_id='metadata'`).run('m'.repeat(2000)), /storage_limit/, table);
      assert.equal(usage('metadata'), before, table);
    }
    sqlite.exec(`UPDATE oauth_grants SET revoked_at=2 WHERE workspace_id='metadata';
      UPDATE claims SET revoked_at=2 WHERE workspace_id='metadata';
      UPDATE wake_deliveries SET status='canceled',last_error='Owner canceled',lease_token=NULL WHERE workspace_id='metadata';
      UPDATE activation_configs SET enabled=0,token_ciphertext=NULL WHERE workspace_id='metadata';
      UPDATE activation_dispatches SET status='canceled',error_code='configuration_revoked' WHERE workspace_id='metadata';`);
    assert.equal(usage('metadata'), before, 'Normal stop/revoke fields use their prepaid reserve.');
  });
  await check('long identifiers and metadata-only rows are charged and quota rejection preserves the ledger', async () => {
    quota(3000); const before = usage();
    assert.throws(() => sqlite.prepare(`INSERT INTO schedules(workspace_id,id,every_minutes,template,next_run_at,created_at)
      VALUES('tenant',?,5,'{}',?,?)`).run('s'.repeat(3000), now, now), /storage_limit/);
    assert.throws(() => sqlite.prepare('UPDATE agents SET name=? WHERE id=?').run('x'.repeat(2000), 'sender'), /storage_limit/);
    assert.equal(usage(), before);
    unlimited();
    const id = 'é'.repeat(1000);
    sqlite.prepare(`INSERT INTO schedules(workspace_id,id,every_minutes,template,next_run_at,created_at)
      VALUES('tenant',?,5,'{}',?,?)`).run(id, now, now);
    assert.ok(usage() - before >= 1024 + 2 * Buffer.byteLength(id), 'Account UTF-8 bytes, not JavaScript character count.');
  });
  await check('nested job transcript creation rolls back the complete request when combined copies exceed quota', async () => {
    quota(11000); const before = usage();
    assert.throws(() => job('atomic-job', 't'.repeat(1200)), /storage_limit/);
    assert.equal(sqlite.prepare('SELECT id FROM jobs WHERE id=?').get('atomic-job'), undefined);
    assert.equal(sqlite.prepare('SELECT id FROM conversations WHERE id=?').get('conv_atomic-job'), undefined);
    assert.equal(usage(), before); unlimited();
  });
  await check('all content copies and idempotency/context metadata contribute to accounting', async () => {
    job('content-job'); const before = usage();
    sqlite.prepare('UPDATE jobs SET idempotency_key=?,spec=? WHERE id=?').run('i'.repeat(1500), JSON.stringify({ goal: 'g'.repeat(1000), inputs: { data: 'd'.repeat(1000) } }), 'content-job');
    assert.ok(usage() >= before + 2 * 3400);
    const resultBefore = usage();
    sqlite.prepare("UPDATE jobs SET result=?,result_by='worker',status='completed' WHERE id=?").run(JSON.stringify({ summary: 'Summary', body: 'b'.repeat(1000) }), 'content-job');
    assert.ok(usage() > resultBefore + 4 * 1000, 'Both job result and immutable message copy are counted.');
    const contextBefore = usage();
    sqlite.prepare("UPDATE conversations SET pinned_context=? WHERE id='conversation'").run('p'.repeat(1000));
    sqlite.prepare("UPDATE conversation_messages SET context=? WHERE source_key='message-conversation'").run(JSON.stringify({ previous_text: 'q'.repeat(1000) }));
    assert.ok(usage() >= contextBefore + 4 * 1000);
  });
  await check('direct metadata writes stop at quota and delete/reduction restores capacity', async () => {
    quota(4000);
    let inserted = 0;
    try { for (; inserted < 20; inserted++) sqlite.prepare("INSERT INTO events(workspace_id,ts,actor,kind,detail) VALUES('tenant',?,'sender','test',?)").run(now, `row-${inserted}`); }
    catch (error) { assert.match(error.message, /storage_limit/); }
    assert.ok(inserted > 0 && inserted < 20);
    const before = usage();
    sqlite.prepare("DELETE FROM events WHERE workspace_id='tenant'").run();
    assert.ok(usage() < before);
    sqlite.prepare("INSERT INTO events(workspace_id,ts,actor,kind) VALUES('tenant',?,'sender','test')").run(now);
    const larger = usage();
    quota(-1000);
    sqlite.prepare("UPDATE conversations SET pinned_context='' WHERE id='conversation'").run();
    assert.ok(usage() < larger);
    sqlite.prepare("UPDATE jobs SET status='canceled',lease_holder=NULL,lease_id=NULL,error='Canceled by owner' WHERE id='content-job'").run();
    unlimited();
  });
  await check('interactive and scheduled consumers keep independent durable cursors', async () => {
    assert.equal((await api.checkConversationInbox(env, worker, 'interactive')).conversations.length, 2);
    await api.acknowledgeConversation(env, worker, 'conversation', 'interactive', cursor, now);
    const first = await api.checkConversationInbox(env, worker, 'interactive');
    const second = await api.checkConversationInbox(env, worker, 'scheduled');
    assert.equal(first.conversations.some(c => c.conversation.id === 'conversation'), false);
    assert.equal(second.conversations.some(c => c.conversation.id === 'conversation'), true);
    await api.acknowledgeConversation(env, worker, 'conversation', 'scheduled', cursor, now);
  });
  await check('repeated or older acknowledgment performs no persistent write', async () => {
    const before = sqlite.prepare('SELECT total_changes() n').get().n;
    const accounted = usage();
    await api.acknowledgeConversation(env, worker, 'conversation', 'interactive', cursor, now + 10000);
    assert.equal(sqlite.prepare('SELECT total_changes() n').get().n, before);
    assert.equal(sqlite.prepare("SELECT updated_at FROM conversation_receipts WHERE consumer_id='interactive'").get().updated_at, now);
    assert.equal(usage(), accounted);
  });
  await check('eight distinct consumer IDs are bounded per connection across conversations', async () => {
    const otherCursor = conversation('other-conversation');
    for (let i = 2; i < 8; i++) await api.acknowledgeConversation(env, worker, 'conversation', `consumer-${i}`, cursor, now);
    await api.acknowledgeConversation(env, worker, 'other-conversation', 'interactive', otherCursor, now);
    await assert.rejects(api.acknowledgeConversation(env, worker, 'other-conversation', 'ninth', otherCursor, now), e => e.status === 429 && e.code === 'consumer_limit' && /existing stable consumer_id/.test(e.message));
    const beforeRead = sqlite.prepare('SELECT total_changes() n').get().n;
    const unread = await api.checkConversationInbox(env, worker, 'ninth');
    assert.ok(unread.conversations.some(c => c.conversation.id === 'other-conversation'));
    assert.equal(sqlite.prepare('SELECT total_changes() n').get().n, beforeRead, 'Reading does not register a ninth consumer or mutate any cursor.');
    assert.throws(() => sqlite.prepare(`INSERT INTO conversation_receipts(workspace_id,conversation_id,agent_id,consumer_id,cursor,updated_at)
      VALUES('tenant','other-conversation','worker','sql-ninth',?,?)`).run(otherCursor, now), /consumer_limit/);
    assert.throws(() => sqlite.prepare("UPDATE conversation_receipts SET consumer_id='sql-new' WHERE consumer_id='interactive' AND conversation_id='other-conversation'").run(), /consumer_limit/);
    assert.equal(sqlite.prepare("SELECT COUNT(DISTINCT consumer_id) n FROM conversation_receipts WHERE workspace_id='tenant' AND agent_id='worker'").get().n, 8);
  });
  await check('two competing consumers cannot exceed the last available slot', async () => {
    const sender = sqlite.prepare("SELECT * FROM agents WHERE id='sender'").get();
    for (let i = 0; i < 7; i++) await api.acknowledgeConversation(env, sender, 'conversation', `sender-${i}`, cursor, now);
    const results = await Promise.allSettled(['last-a', 'last-b'].map(id => api.acknowledgeConversation(env, sender, 'conversation', id, cursor, now)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'consumer_limit');
  });
  await check('receipt rows consume storage and cannot bypass a full workspace using a fresh consumer', async () => {
    const before = usage(); quota();
    assert.throws(() => sqlite.prepare(`INSERT INTO conversation_receipts(workspace_id,conversation_id,agent_id,consumer_id,cursor,updated_at)
      VALUES('tenant','conversation','another-agent','new',?,?)`).run(cursor, now), /storage_limit/);
    assert.equal(usage(), before); unlimited();
  });
  await check('workspace transfers charge the receiving tenant and reject growth atomically', async () => {
    workspace('other');
    sqlite.prepare("UPDATE workspaces SET storage_limit_bytes=? WHERE id='other'").run(usage('other'));
    assert.throws(() => sqlite.prepare("UPDATE schedules SET workspace_id='other' WHERE workspace_id='tenant'").run(), /storage_limit/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM schedules WHERE workspace_id='other'").get().n, 0);
  });
  await check('shared cap applies to tenant growth while preserving self-hosted default capacity', async () => {
    const before = usage();
    sqlite.prepare("UPDATE workspace_storage_usage SET accounted_bytes=? WHERE workspace_id='tenant'").run(api.SHARED_ACCOUNTED_STORAGE_LIMIT_BYTES);
    try {
      assert.throws(() => workspace('global-full'), /storage_limit/);
      sqlite.prepare("INSERT INTO events(workspace_id,ts,actor,kind) VALUES('default',?,'owner','self-hosted')").run(now);
    } finally { sqlite.prepare("UPDATE workspace_storage_usage SET accounted_bytes=? WHERE workspace_id='tenant'").run(before); }
    assert.equal(sqlite.prepare("SELECT id FROM workspaces WHERE id='global-full'").get(), undefined);
  });
  await check('upgrade preserves over-limit content and legacy consumers while refusing new growth', async () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      for (const [file, source] of sql) if (file < '0017') legacy.exec(source);
      workspace('legacy', legacy, 2000); agent('legacy-agent', legacy, 'legacy');
      job('legacy-job', 'Preserved title '.repeat(500), legacy, 'legacy');
      for (let i = 0; i < 10; i++) legacy.prepare(`INSERT INTO conversation_receipts(workspace_id,conversation_id,agent_id,consumer_id,cursor,updated_at)
        VALUES('legacy','conv_legacy-job','legacy-agent',?,1,?)`).run(`existing-${i}`, now);
      for (const [file, source] of sql) if (file >= '0017') legacy.exec(source);
      assert.ok(usage('legacy', legacy) > 2000);
      assert.equal(legacy.prepare('SELECT title FROM jobs WHERE id=?').get('legacy-job').title, 'Preserved title '.repeat(500));
      assert.equal(legacy.prepare('SELECT COUNT(*) n FROM conversation_receipts').get().n, 10);
      assert.throws(() => legacy.prepare("UPDATE agents SET name=name||'more' WHERE id='legacy-agent'").run(), /storage_limit/);
      legacy.prepare("UPDATE jobs SET status='canceled',error='Owner canceled',lease_holder=NULL WHERE id='legacy-job'").run();
      legacy.prepare("UPDATE conversation_receipts SET cursor=2,updated_at=? WHERE consumer_id='existing-0'").run(now + 1);
      legacy.prepare("DELETE FROM jobs WHERE id='legacy-job'").run();
      reconciles(legacy);
    } finally { legacy.close(); }
  });
  await check('retained activation evidence survives workspace deletion and releases quota at retention cleanup', async () => {
    workspace('deleted-workspace');
    sqlite.prepare(`INSERT INTO activation_launch_attempts(dispatch_id,attempt,reservation_nonce,workspace_id,agent_id,job_id,admitted_at)
      VALUES('retained-dispatch',1,'retained-nonce','deleted-workspace','old-agent','old-job',?)`).run(now);
    sqlite.prepare("DELETE FROM workspaces WHERE id='deleted-workspace'").run();
    assert.ok(usage('deleted-workspace') > 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activation_launch_attempts WHERE workspace_id='deleted-workspace'").get().n, 1);
    sqlite.prepare("DELETE FROM activation_launch_attempts WHERE workspace_id='deleted-workspace'").run();
    assert.equal(usage('deleted-workspace'), 0);
    assert.equal(sqlite.prepare("SELECT * FROM workspace_storage_usage WHERE workspace_id='deleted-workspace'").get(), undefined);
  });
  await check('real completed lifecycles expose representative accounted storage at ten and thirty-two MiB', async () => {
    const measurements = [];
    for (const [label, promptBytes, resultBodyBytes] of [['short', 256, 1024], ['typical', 1024, 4096], ['long', 4096, 16384]]) {
      const ws = `ws_01MEASURE${label.toUpperCase().padEnd(19, '0')}`;
      workspace(ws);
      const sender = agent(`ag_01SEND${label.toUpperCase().padEnd(21, '0')}`, sqlite, ws);
      const receiver = agent(`ag_01WORK${label.toUpperCase().padEnd(21, '0')}`, sqlite, ws);
      const measuredEnv = { ...env, WORKSPACE_ID: ws };
      const baselineBytes = usage(ws);
      const sent = await api.sendMessage(measuredEnv, { owner: false, agent: sender }, {
        to: receiver.id, message: 'p'.repeat(promptBytes), title: 'Synthetic storage measurement', idempotency_key: `storage-measure-${label}`,
      }, now);
      const sentBytes = usage(ws) - baselineBytes;
      await api.acknowledgeConversation(measuredEnv, receiver, sent.conversation.id, 'interactive', sent.message.id, now);
      const held = await api.claimRequest(measuredEnv, receiver, sent.request.id, 'execution-1', now);
      assert.ok(held.token);
      assert.equal((await api.submitResult(measuredEnv, held.token, { summary: 's'.repeat(120), body: 'b'.repeat(resultBodyBytes) }, [], now)).kind, 'accepted');
      const history = await api.readConversation(measuredEnv, { owner: false, agent: sender }, sent.conversation.id);
      await api.acknowledgeConversation(measuredEnv, sender, sent.conversation.id, 'interactive', history.next_cursor, now);
      const completedBytes = usage(ws) - baselineBytes;
      await api.acknowledgeConversation(measuredEnv, receiver, sent.conversation.id, 'scheduled', sent.message.id, now);
      await api.acknowledgeConversation(measuredEnv, sender, sent.conversation.id, 'scheduled', history.next_cursor, now);
      const twoConsumersBytes = usage(ws) - baselineBytes;
      assert.ok(completedBytes > sentBytes);
      assert.ok(twoConsumersBytes > completedBytes);
      measurements.push({ label, prompt_bytes: promptBytes, result_body_bytes: resultBodyBytes, baseline_bytes: baselineBytes,
        sent_bytes: sentBytes, completed_bytes: completedBytes, two_consumers_each_bytes: twoConsumersBytes,
        completed_capacity_10_mib: Math.floor((10 * 1024 * 1024 - baselineBytes) / completedBytes),
        completed_capacity_32_mib: Math.floor((api.DEFAULT_HOSTED_STORAGE_LIMIT_BYTES - baselineBytes) / completedBytes),
        projected_500_completed_mib: Number(((baselineBytes + 500 * completedBytes) / (1024 * 1024)).toFixed(3)) });
    }
    assert.ok(measurements.find(row => row.label === 'typical').completed_capacity_32_mib >= 500);
    console.log('storage_lifecycle_measurements=' + JSON.stringify(measurements));
  });
  console.log(`\n${checks} storage accounting checks passed.`);
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
  await rm(temp, { recursive: true, force: true });
}
