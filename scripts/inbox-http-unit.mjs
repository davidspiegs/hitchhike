/** Real Worker routes with migrated SQLite, synthetic credentials, and no network. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-inbox-http-'));
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('This suite cannot make external requests'); };
const databases = [];
const base = 'http://127.0.0.1:8787';
let passed = 0;
const check = async (name, fn) => { await fn(); console.log(`ok ${++passed} - ${name}`); };
const digest = value => createHash('sha256').update(value).digest('hex');
const edgeBindings = {
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  GLOBAL_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

try {
  const bundle = join(temporary, 'worker.mjs');
  await build({ stdin: { contents: 'export { default as worker } from "./src/index.ts"; export { configurationIssue } from "./src/configuration.ts"; export { presenceInterval } from "./src/presence.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const { worker, configurationIssue, presenceInterval } = await import(pathToFileURL(bundle).href);
  async function fixture(hosted = false) {
    const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
    for (const file of (await readdir(join(root, 'migrations'))).filter(file => file.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(root, 'migrations', file), 'utf8'));
    class Statement {
      constructor(sql, values = []) { this.sql = sql; this.values = values; }
      bind(...values) { return new Statement(this.sql, values); }
      async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
      async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
      async run() {
        const query = sqlite.prepare(this.sql);
        if (query.columns().length) { const results = query.all(...this.values); return { results, meta: { changes: results.length }, success: true }; }
        return { meta: query.run(...this.values), success: true };
      }
    }
    const DB = { prepare: sql => new Statement(sql), async batch(statements) {
      sqlite.exec('BEGIN');
      try { const out = []; for (const statement of statements) out.push(await statement.run()); sqlite.exec('COMMIT'); return out; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    const env = { DB, ...edgeBindings, HOSTED: String(hosted), SIGNUP_MODE: 'public', PUBLIC_URL: base, ADMIN_TOKEN: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex') };
    if (hosted) {
      sqlite.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)').run('other', 'Other fixture', Date.now());
      // Hosted static keys remain subject to the owning account's restrictions.
      for (const workspace of ['default', 'other']) sqlite.prepare('INSERT INTO users(id,google_sub,email,name,workspace_id,created_at) VALUES (?,?,?,?,?,?)')
        .run('user-' + workspace, 'synthetic-' + workspace, workspace + '@example.test', 'Fixture owner', workspace, Date.now());
    }
    function agent(id, workspace = 'default', poll = 10) {
      const token = randomBytes(32).toString('hex');
      sqlite.prepare('INSERT INTO agents(id,workspace_id,handle,name,token_hash,can_request,can_work,work_types,poll_minutes,created_at) VALUES (?,?,?,?,?,1,1,?,?,?)')
        .run(id, workspace, id, id, digest(token), '["task"]', poll, Date.now());
      return { id, token };
    }
    async function request(path, { method = 'GET', token, body, origin = base } = {}) {
      const headers = { accept: 'application/json' };
      if (token) headers.authorization = 'Bearer ' + token;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const background = [];
      const response = await worker.fetch(new Request(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env,
        { waitUntil: promise => background.push(promise), passThroughOnException() {} });
      await Promise.all(background);
      const text = await response.text();
      let data; try { data = JSON.parse(text); } catch {}
      return { status: response.status, data, text };
    }
    function result(id, from, workspace = 'default') {
      const now = Date.now();
      sqlite.prepare(`INSERT INTO jobs(id,workspace_id,v,type,from_agent,to_agent,title,spec,status,lease_seconds,result,created_at,updated_at,completed_at)
        VALUES (?,?,'1','task',?,'worker','Fixture result','{"goal":"Synthetic"}','completed',300,?,?,?,?)`)
        .run(id, workspace, from, JSON.stringify({ summary: `Result ${id}`, validation: { ok: true } }), now, now, now);
      sqlite.prepare("INSERT INTO events(workspace_id,ts,job_id,actor,kind,detail) VALUES (?,?,?,'worker','completed','{}')").run(workspace, now, id);
    }
    function queued(id, to, { workspace = 'default', priority = 0, type = 'task', from = 'owner' } = {}) {
      const now = Date.now();
      sqlite.prepare(`INSERT INTO jobs(id,workspace_id,v,type,from_agent,to_agent,title,spec,status,lease_seconds,priority,created_at,updated_at)
        VALUES (?,?,'0.1',?,?,?,'Targeted claim fixture','{"goal":"Synthetic"}','queued',300,?,?,?)`)
        .run(id, workspace, type, from, to, priority, now, now);
    }
    return { sqlite, env, agent, request, result, queued };
  }

  await check('public deployments reject weak/example secrets without requiring a hosted owner key', async () => {
    const strong = randomBytes(32).toString('hex'), other = randomBytes(32).toString('hex');
    const hosted = { ...edgeBindings, HOSTED: 'true', PUBLIC_URL: 'https://relay.example.test', ENCRYPTION_KEY: strong };
    assert.equal(configurationIssue(hosted, hosted.PUBLIC_URL), null);
    assert.match(configurationIssue({ ...hosted, AUTH_RATE_LIMITER: undefined }, hosted.PUBLIC_URL), /AUTH_RATE_LIMITER/);
    for (const key of [undefined, 'x', 'replace-with-a-separate-random-encryption-key', 'a'.repeat(40)]) {
      assert.match(configurationIssue({ ...hosted, ENCRYPTION_KEY: key }, hosted.PUBLIC_URL), /ENCRYPTION_KEY/);
    }
    const local = { HOSTED: 'false', PUBLIC_URL: base, ADMIN_TOKEN: 'local', ENCRYPTION_KEY: 'local' };
    assert.equal(configurationIssue(local, base), null);
    assert.ok(configurationIssue(local, 'https://public.example.test'));
    assert.match(configurationIssue({ ...hosted, HOSTED: 'false', ADMIN_TOKEN: strong }, hosted.PUBLIC_URL), /different/);
    assert.equal(configurationIssue({ ...hosted, HOSTED: 'false', ADMIN_TOKEN: other }, hosted.PUBLIC_URL), null);
    const f = await fixture(); f.env.PUBLIC_URL = 'https://relay.example.test'; f.env.ADMIN_TOKEN = 'x';
    const response = await f.request('/v1/admin/agents', { token: 'x', origin: f.env.PUBLIC_URL });
    assert.equal(response.status, 503); assert.equal(response.data.error.code, 'setup_required');
    assert.ok(!response.text.includes(f.env.ENCRYPTION_KEY));
  });

  for (const hosted of [false, true]) {
    await check(`${hosted ? 'hosted' : 'self-host'} targeted pickup never leases unrelated work or bypasses eligibility`, async () => {
      const f = await fixture(hosted), receiver = f.agent('receiver'), other = f.agent('other-receiver');
      const poll = id => f.request('/v1/work/next?format=json&job_id=' + encodeURIComponent(id), { method: 'POST', token: receiver.token });
      const job = id => f.sqlite.prepare('SELECT status,attempts,lease_holder,lease_id FROM jobs WHERE id=?').get(id);
      const claims = () => f.sqlite.prepare('SELECT COUNT(*) n FROM claims').get().n;
      const identity = await f.request('/v1/me', { token: receiver.token });
      assert.equal(identity.status, 200, JSON.stringify(identity.data));
      assert.equal(identity.data.capabilities.targeted_claim, true);
      f.queued('unrelated-first', receiver.id, { priority: 10 });
      f.queued('wanted-task', receiver.id, { priority: -10 });
      f.queued('other-receiver-task', other.id);
      f.queued('unsupported-type', receiver.id, { type: 'research' });
      f.queued('blocked-sender', receiver.id, { from: 'unapproved-sender' });
      f.sqlite.prepare('UPDATE agents SET accept_from=? WHERE id=?').run('["approved-sender"]', receiver.id);
      const denied = ['missing-task', 'other-receiver-task', 'unsupported-type', 'blocked-sender'];
      if (hosted) {
        f.queued('foreign-task', receiver.id, { workspace: 'other' });
        denied.push('foreign-task');
      }
      const allJobs = () => f.sqlite.prepare('SELECT * FROM jobs ORDER BY id').all();
      const untouched = allJobs();
      for (const id of denied) {
        const response = await poll(id);
        assert.equal(response.status, 200, id);
        assert.equal(response.data.job, null, id);
      }
      assert.deepEqual(allJobs(), untouched);
      assert.equal(claims(), 0);
      for (const id of ['', '*', 'bad id', 'x'.repeat(129)]) assert.equal((await poll(id)).status, 400);
      assert.deepEqual(allJobs(), untouched);
      const first = await poll('wanted-task');
      assert.equal(first.status, 200); assert.equal(first.data.job.id, 'wanted-task'); assert.equal(first.data.resent, false);
      assert.equal(job('wanted-task').attempts, 1); assert.equal(job('unrelated-first').status, 'queued');
      assert.equal(job('unrelated-first').attempts, 0); assert.equal(claims(), 1);
      // Missing or unavailable resume targets must not reissue some other held claim.
      for (let i = 0; i < 4; i++) assert.equal((await poll('missing-task')).data.job, null);
      assert.equal(claims(), 1); assert.equal(job('wanted-task').attempts, 1);
      assert.equal((await poll('unrelated-first')).data.job, null); // max_leases remains enforced
      assert.equal(job('unrelated-first').attempts, 0); assert.equal(claims(), 1);
      const replay = await poll('wanted-task');
      assert.equal(replay.data.job.id, 'wanted-task'); assert.equal(replay.data.resent, true);
      assert.equal(job('wanted-task').attempts, 1); assert.equal(claims(), 2);
      f.sqlite.prepare('UPDATE jobs SET status=\'completed\',lease_holder=NULL,lease_expires_at=NULL,lease_id=NULL WHERE id=?').run('wanted-task');
      assert.equal((await poll('wanted-task')).data.job, null);
      assert.equal(job('unrelated-first').attempts, 0);
      const ordinary = await f.request('/v1/work/next?format=json', { method: 'POST', token: receiver.token });
      assert.equal(ordinary.data.job.id, 'unrelated-first');
    });
    await check(`${hosted ? 'hosted' : 'self-host'} HTTP inbox repeats until ack and drains more than 100 results`, async () => {
      const f = await fixture(hosted), sender = f.agent('sender'), other = f.agent('other-sender', hosted ? 'other' : 'default');
      for (let i = 0; i < 125; i++) f.result('job-' + i, sender.id);
      f.result('private-other', other.id, hosted ? 'other' : 'default');
      const first = await f.request('/v1/inbox?limit=50', { token: sender.token });
      assert.equal(first.status, 200); assert.equal(first.data.arrived.length, 50); assert.equal(first.data.has_more, true);
      assert.equal(first.data.arrived[0].result.summary, 'Result job-0');
      const repeated = await f.request('/v1/inbox?limit=50', { token: sender.token });
      assert.deepEqual(repeated.data, first.data);
      const foreignAck = await f.request('/v1/inbox/ack', { method: 'POST', token: other.token, body: { delivery_cursor: first.data.delivery_cursor } });
      assert.equal(foreignAck.status, 400);
      const get = await f.request('/v1/jobs/job-0?full=1', { token: sender.token });
      assert.equal(get.status, 200); assert.equal(f.sqlite.prepare("SELECT retrieved_at FROM jobs WHERE id='job-0'").get().retrieved_at, null);
      let page = first.data; const seen = [];
      do {
        seen.push(...page.arrived.map(job => job.id));
        const ack = await f.request('/v1/inbox/ack', { method: 'POST', token: sender.token, body: { delivery_cursor: page.delivery_cursor } });
        assert.equal(ack.status, 200); assert.deepEqual(ack.data, { ok: true });
        if (!page.has_more) break;
        page = (await f.request('/v1/inbox?limit=50', { token: sender.token })).data;
      } while (true);
      assert.equal(seen.length, 125); assert.equal(new Set(seen).size, 125); assert.ok(!seen.includes('private-other'));
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM jobs WHERE from_agent='sender' AND retrieved_at IS NOT NULL").get().n, 125);
      assert.equal((await f.request('/v1/inbox', { token: sender.token })).data.arrived.length, 0);
      assert.equal((await f.request('/v1/inbox/ack', { method: 'POST', token: sender.token, body: { delivery_cursor: page.delivery_cursor } })).status, 200);
      assert.equal((await f.request('/v1/inbox/ack', { method: 'POST', token: sender.token, body: { delivery_cursor: page.delivery_cursor + 1 } })).status, 400);
      assert.equal((await f.request('/v1/inbox?include_seen=true&limit=100', { token: sender.token })).data.arrived.length, 100);
      assert.equal((await f.request('/v1/inbox')).status, 401);
      if (!hosted) assert.equal((await f.request('/v1/inbox', { token: f.env.ADMIN_TOKEN })).status, 403);
      for (const query of ['limit=0', 'limit=101', 'limit=1.1', 'cursor=-1', 'cursor=9007199254740992', 'include_seen=1']) {
        assert.equal((await f.request('/v1/inbox?' + query, { token: sender.token })).status, 400, query);
      }
    });
  }

  await check('HTTP and MCP presence honor poll cadence without a write on every request', async () => {
    const f = await fixture(), sender = f.agent('presence');
    assert.equal(presenceInterval(10), 5 * 60_000); assert.equal(presenceInterval(null), 60 * 60_000);
    assert.equal(presenceInterval(1), 30_000);
    const old = Date.now() - 30 * 60_000;
    f.sqlite.prepare('UPDATE agents SET last_seen_at=? WHERE id=?').run(old, sender.id);
    assert.equal((await f.request('/v1/me', { token: sender.token })).status, 200);
    const seen = () => f.sqlite.prepare('SELECT last_seen_at FROM agents WHERE id=?').get(sender.id).last_seen_at;
    assert.ok(seen() > old); const afterHttp = seen();
    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    assert.equal((await f.request('/mcp', { method: 'POST', token: sender.token, body: rpc })).status, 200);
    assert.equal(seen(), afterHttp);
    f.sqlite.prepare('UPDATE agents SET last_seen_at=? WHERE id=?').run(old, sender.id);
    assert.equal((await f.request('/mcp', { method: 'POST', token: sender.token, body: rpc })).status, 200);
    assert.ok(seen() > old);
  });

  await check('successful self-host deletion is immediately ready for fresh setup', async () => {
    const f = await fixture(); f.agent('before-reset');
    const deleted = await f.request('/v1/admin/workspace', { method: 'DELETE', token: f.env.ADMIN_TOKEN, body: { confirmation: 'DELETE' } });
    assert.equal(deleted.status, 200);
    assert.equal(f.sqlite.prepare("SELECT paused FROM workspaces WHERE id='default'").get().paused, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM agents').get().n, 0);
    const created = await f.request('/v1/admin/agents', { method: 'POST', token: f.env.ADMIN_TOKEN, body: { id: 'new-sender', name: 'Fresh sender', platform: 'codex', can_work: false } });
    assert.equal(created.status, 201);
  });
  await check('an interrupted self-host reset remains paused until cleanup succeeds', async () => {
    const f = await fixture(); f.agent('before-interrupted-reset');
    const prepare = f.env.DB.prepare;
    f.env.DB.prepare = sql => {
      if (sql.startsWith('DELETE FROM pairing_codes')) return { bind() { return this; }, async run() { throw new Error('Synthetic cleanup interruption'); } };
      return prepare(sql);
    };
    const failed = await f.request('/v1/admin/workspace', { method: 'DELETE', token: f.env.ADMIN_TOKEN, body: { confirmation: 'DELETE' } });
    assert.equal(failed.status, 500);
    assert.equal(f.sqlite.prepare("SELECT paused FROM workspaces WHERE id='default'").get().paused, 1);
    f.env.DB.prepare = prepare;
    assert.equal((await f.request('/v1/admin/workspace', { method: 'DELETE', token: f.env.ADMIN_TOKEN, body: { confirmation: 'DELETE' } })).status, 200);
    assert.equal(f.sqlite.prepare("SELECT paused FROM workspaces WHERE id='default'").get().paused, 0);
  });
  console.log(`\n${passed} inbox, configuration, presence and reset checks passed.`);
} finally {
  globalThis.fetch = originalFetch;
  for (const db of databases) db.close();
  await rm(temporary, { recursive: true, force: true });
}
