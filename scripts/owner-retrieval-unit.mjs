/** Owner retrieval evidence and directed-claim payload regressions. Synthetic credentials only;
 * any attempted network request fails the suite. This proves relay behavior,
 * not provider execution, independently routable Dots, or device usability. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-next-http-'));
const databases = [], base = 'http://127.0.0.1:8787';
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('HTTP regression suite cannot make network requests'); };
const digest = value => createHash('sha256').update(value).digest('hex');
let count = 0;
async function check(name, test) { await test(); console.log(`ok ${++count} - ${name}`); }
function status(response, expected) { assert.equal(response.status, expected, response.text); return response.data; }

try {
  const bundle = join(temporary, 'worker.mjs');
  await build({ stdin: { contents: 'export {default} from "./src/index"; export {jobView} from "./src/store";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const { default: worker, jobView } = await import(pathToFileURL(bundle).href);
  async function fixture(hosted = false) {
    const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
    for (const file of (await readdir(join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(root, 'migrations', file), 'utf8'));
    sqlite.exec('PRAGMA foreign_keys=ON');
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
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    const env = { DB, HOSTED: String(hosted), ALLOW_DEV_AUTH: 'true', PUBLIC_URL: base,
      ADMIN_TOKEN: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex') };
    async function request(path, { method = 'GET', token, body, cookie, csrf, origin = base, headers: extra = {} } = {}) {
      const headers = { accept: 'application/json', ...extra };
      if (token) headers.authorization = 'Bearer ' + token;
      if (cookie) headers.cookie = cookie;
      if (csrf) headers['x-csrf-token'] = csrf;
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (origin) headers.origin = origin;
      const background = [];
      const response = await worker.fetch(new Request(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env,
        { waitUntil: promise => background.push(promise), passThroughOnException() {} });
      await Promise.all(background);
      const text = await response.text();
      let data; try { data = JSON.parse(text); } catch {}
      return { status: response.status, data, text, headers: response.headers };
    }
    async function signIn(email) {
      const response = await request('/auth/dev', { method: 'POST', body: { email } }); status(response, 200);
      const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
      const session = status(await request('/auth/session', { cookie }), 200);
      assert.equal(session.authenticated, true);
      return { cookie, csrf: session.csrfToken, workspace: session.workspace.id, user: session.user.id };
    }
    const owner = hosted ? await signIn('owner@example.test') : { token: env.ADMIN_TOKEN, workspace: 'default' };
    const ownerRequest = (path, options = {}) => request(path, { ...owner, ...options });
    function agent(id, { workspace = owner.workspace, can_request = true, can_work = true } = {}) {
      const token = randomBytes(32).toString('hex');
      sqlite.prepare('INSERT INTO agents(id,workspace_id,handle,name,token_hash,platform,can_request,can_work,work_types,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, workspace, id, id, digest(token), id.includes('claude') ? 'claude' : 'dot', Number(can_request), Number(can_work), '["task","review"]', Date.now());
      return { id, token, workspace };
    }
    function oauth(agent, scopes, human = owner) {
      const id = randomBytes(8).toString('hex'), token = 'access_' + randomBytes(32).toString('hex'), now = Date.now();
      sqlite.prepare('INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES (?,?,?,?)').run(id, 'Synthetic scope client', '[]', now);
      sqlite.prepare('INSERT INTO oauth_grants(id,user_id,workspace_id,agent_id,auth_generation,client_id,scope,resource,created_at) VALUES (?,?,?,?,1,?,?,?,?)')
        .run(id, human.user, agent.workspace, agent.id, id, scopes.join(' '), base + '/mcp', now);
      sqlite.prepare('INSERT INTO oauth_tokens(token_hash,grant_id,kind,created_at,expires_at) VALUES (?,?,\'access\',?,?)').run(digest(token), id, now, now + 900000);
      return token;
    }
    async function enable() { return status(await ownerRequest('/v1/workspace/release', { method: 'PUT', body: { enabled: true } }), 200); }
    async function send(from, to, message = 'Review this synthetic plan.', extra = {}) {
      return status(await request('/v1/conversations', { method: 'POST', token: from.token, body: { to: to.id, message, ...extra } }), 201);
    }
    async function claim(to, id, consumer_id = 'scheduled-1') {
      return status(await request(`/v1/requests/${id}/claim`, { method: 'POST', token: to.token, body: { consumer_id } }), 200);
    }
    async function reply(to, id, claim_id, message, resultStatus = 'completed') {
      return request(`/v1/requests/${id}/reply`, { method: 'POST', token: to.token, body: { claim_id, message, status: resultStatus } });
    }
    return { sqlite, env, request, ownerRequest, owner, signIn, agent, oauth, enable, send, claim, reply };
  }


  async function completedWebsiteTest(f, receiver, key = 'website-marker') {
    const sent = status(await f.ownerRequest(`/v1/admin/agents/${receiver.id}/test`, { method: 'POST', body: {}, headers: { 'idempotency-key': key } }), 201);
    const picked = status(await f.request(`/v1/work/next?format=json&job_id=${sent.job.id}`, { method: 'POST', token: receiver.token }), 200);
    const claim = picked.claim_id || picked.submit_url.split('/').at(-1);
    status(await f.request('/v1/submit', { method: 'POST', token: receiver.token, headers: { 'X-Claim-Token': claim }, body: { status: 'completed', summary: sent.job.inputs.expected_response } }), 200);
    const job = status(await f.ownerRequest(`/v1/jobs/${sent.job.id}?full=1`), 200).job;
    assert.equal(job.status, 'completed'); assert.equal(job.result.validation.ok, true);
    assert.equal(job.result.summary, sent.job.inputs.expected_response); assert.equal(job.retrieved_at, null);
    return job;
  }
  for (const hosted of [false, true]) {
    const mode = hosted ? 'hosted' : 'self-host';
    await check(`${mode}: website acceptance records owner retrieval, never peer or background proof`, async () => {
      const f = await fixture(hosted), worker = f.agent('claude'); await f.enable();
      const job = await completedWebsiteTest(f, worker);
      const path = `/v1/jobs/${job.id}/accept`;
      const before = status(await f.ownerRequest(`/v1/agents/${worker.id}/collaboration`), 200);
      assert.equal(before.readiness.collaboration.verified, false);
      status(await f.request(path, { token: worker.token, method: 'POST', body: {} }), 403);
      if (hosted) {
        const foreign = await f.signIn('foreign@example.test');
        status(await f.request(path, { ...foreign, method: 'POST', body: {} }), 404);
        status(await f.request(path, { cookie: f.owner.cookie, method: 'POST', body: {} }), 403);
      }
      const accepted = status(await f.ownerRequest(path, { method: 'POST', body: {} }), 200).job;
      assert.ok(accepted.retrieved_at);
      assert.equal(status(await f.ownerRequest(path, { method: 'POST', body: {} }), 200).job.retrieved_at, accepted.retrieved_at);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE workspace_id=? AND job_id=? AND kind='accepted'").get(f.owner.workspace,job.id).n, 1);
      const after = status(await f.ownerRequest(`/v1/agents/${worker.id}/collaboration`), 200);
      assert.equal(after.readiness.collaboration.verified, true);
      assert.equal(after.readiness.collaboration.retrieved_at, accepted.retrieved_at);
      assert.equal(after.readiness.peer_collaboration.verified, false);
      assert.equal(after.readiness.background.verified, false);
      const finished=status(await f.ownerRequest(`/v1/agents/${worker.id}/onboarding`, { method: 'PATCH', body: { step: 'done' } }), 200);
      assert.equal(finished.onboarding.step,'done');
      assert.equal(finished.readiness.peer_collaboration.verified,false);
      assert.equal(finished.readiness.background.verified,false);
    });
    await check(`${mode}: owner acceptance cannot impersonate originating-assistant retrieval`, async () => {
      const f = await fixture(hosted), sender = f.agent('dot'), worker = f.agent('claude'); await f.enable();
      const sent = await f.send(sender,worker,'Peer result for retrieval isolation.');
      const picked = await f.claim(worker,sent.request.id,'peer-run');
      status(await f.reply(worker,sent.request.id,picked.claim_id,'Completed the peer request.'),200);
      const accepted = status(await f.ownerRequest(`/v1/jobs/${sent.request.id}/accept`, { method: 'POST', body: {} }),200).job;
      assert.equal(accepted.retrieved_at,null);
      const cfg = status(await f.ownerRequest(`/v1/agents/${worker.id}/collaboration`),200);
      assert.equal(cfg.readiness.peer_collaboration.verified,false);
      const page = status(await f.request(`/v1/conversations/${sent.conversation.id}`,{token:sender.token}),200);
      status(await f.request(`/v1/conversations/${sent.conversation.id}/acknowledge`,{token:sender.token,method:'POST',body:{consumer_id:'origin',cursor:page.next_cursor}}),200);
      assert.equal(status(await f.ownerRequest(`/v1/agents/${worker.id}/collaboration`),200).readiness.peer_collaboration.verified,true);
    });
    await check(`${mode}: retrieval still records when the optional acceptance event cannot fit`, async () => {
      const f = await fixture(hosted), worker = f.agent('claude'); await f.enable();
      const job = await completedWebsiteTest(f,worker);
      f.sqlite.prepare('UPDATE workspaces SET storage_limit_bytes=(SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=workspaces.id) WHERE id=?').run(f.owner.workspace);
      const accepted = status(await f.ownerRequest(`/v1/jobs/${job.id}/accept`, { method: 'POST', body: {} }),200).job;
      assert.ok(accepted.retrieved_at);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE workspace_id=? AND job_id=? AND kind='accepted'").get(f.owner.workspace,job.id).n,0);
    });
    await check(`${mode}: HTTP and MCP claims retain one full custom prompt and every policy field`, async () => {
      const f = await fixture(hosted), sender = f.agent('dot'), worker = f.agent('claude'); await f.enable();
      const custom = 'Unique owner instruction. ' + 'Retain the original boundaries. '.repeat(300);
      const cfg = status(await f.ownerRequest(`/v1/agents/${worker.id}/collaboration`, { method:'PUT', body:{expected_version:0,instructions:{profile:'delegate',custom_prompt:custom},sharing:{instructions:'Only share supplied project context.'},authorization_boundaries:['Ask before publishing.']} }),200);
      async function validate(picked,sent,raw) {
        assert.equal(picked.configuration.settings.instructions.custom_prompt,custom);
        const nested = picked.request.collaboration_configuration;
        assert.equal(Object.hasOwn(nested.settings.instructions,'custom_prompt'),false);
        assert.equal(nested.version,cfg.version);
        const compactSettings = structuredClone(picked.configuration.settings);
        delete compactSettings.instructions.custom_prompt;
        assert.deepEqual(nested.settings,compactSettings);
        assert.deepEqual(nested.roster,picked.configuration.roster);
        assert.equal(raw.split(JSON.stringify(custom).slice(1,-1)).length-1,1);
        const row = f.sqlite.prepare('SELECT * FROM jobs WHERE id=? AND workspace_id=?').get(sent.request.id,f.owner.workspace);
        row.collaboration_configuration=picked.configuration;
        assert.equal(jobView(row).collaboration_configuration.settings.instructions.custom_prompt,custom,'ordinary views keep owner instructions');
        assert.equal(row.collaboration_configuration.settings.instructions.custom_prompt,custom,'compact view does not mutate source configuration');
        assert.equal(picked.request.conversation_context.context_requires_brief,false);
        status(await f.reply(worker,sent.request.id,picked.claim_id,'Completed with current policy.'),200);
      }
      const first = await f.send(sender,worker,'HTTP policy check.');
      const http = await f.request(`/v1/requests/${first.request.id}/claim`, { token:worker.token,method:'POST',body:{consumer_id:'http-run'} });
      await validate(status(http,200),first,http.text);
      const second = await f.send(sender,worker,'MCP policy check.');
      const rpc = status(await f.request('/mcp',{token:worker.token,method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'claim_request',arguments:{request_id:second.request.id,consumer_id:'mcp-run'}}}}),200);
      assert.equal(rpc.error,undefined);assert.equal(rpc.result.isError,false);
      const encoded = rpc.result.content[0].text;
      await validate(JSON.parse(encoded),second,encoded);
      assert.equal(status(await f.request('/v1/configuration',{token:worker.token}),200).settings.instructions.custom_prompt,custom);
      // The serialization optimization must not exclude owner instructions from
      // the essential-context size check: multibyte text makes that observable.
      const largeCustom = '😀'.repeat(7500);
      status(await f.ownerRequest(`/v1/agents/${worker.id}/collaboration`, { method:'PUT', body:{expected_version:cfg.version,instructions:{custom_prompt:largeCustom}} }),200);
      const large = await f.send(sender,worker,'Work '.repeat(4000));
      status(await f.ownerRequest(`/v1/conversations/${large.conversation.id}/context`, {method:'PATCH',body:{expected_version:0,pinned_context:'Approved context. '.repeat(1100)}}),200);
      const largeClaim = await f.claim(worker,large.request.id,'large-context');
      assert.equal(largeClaim.configuration.settings.instructions.custom_prompt,largeCustom);
      assert.equal(largeClaim.request.conversation_context.context_requires_brief,true);
    });
  }
  console.log(`\n${count} owner-retrieval and claim-payload checks passed.`);
} finally {
  globalThis.fetch=originalFetch;
  for(const db of databases)db.close();
  await rm(temporary,{recursive:true,force:true});
}
