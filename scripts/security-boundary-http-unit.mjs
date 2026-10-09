/** Security boundaries exercised through the real HTTP/MCP Worker and migrated
 * SQLite. All credentials are generated fixtures; outbound fetch always fails.
 * The one direct acknowledgment call isolates storage writes from HTTP metering.
 */
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-security-boundary-http-'));
const base = 'https://boundary.example.test', issuer = 'https://boundary-test.clerk.accounts.dev';
const webhookKey = Buffer.from('synthetic-http-boundary-webhook-secret');
const databases = [], originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Security boundary tests prohibit outbound network requests'); };
const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(16).toString('hex');
const allScopes = ['relay:read', 'relay:send', 'relay:work', 'offline_access'];
let checks = 0, failures = 0;
async function check(name, test) {
  try { await test(); console.log(`ok ${++checks} - ${name}`); }
  catch (error) { failures++; console.error(`not ok - ${name}\n${error.stack ?? error}`); }
}
function status(response, expected) { assert.equal(response.status, expected, response.text); return response.data; }
function rpcData(response) {
  const value = status(response, 200);
  assert.equal(value.error, undefined, JSON.stringify(value));
  assert.equal(value.result?.isError, false, JSON.stringify(value));
  return JSON.parse(value.result.content[0].text);
}
function rpcDenied(response) {
  const value = status(response, 200);
  assert.ok(value.error || value.result?.isError === true, `MCP operation unexpectedly succeeded: ${response.text}`);
}

try {
  const bundle = join(temporary, 'boundary.mjs');
  await build({ stdin: { contents: "export { default as worker } from './src/index'; export { sealAgentKey } from './src/crypto'; export { acknowledgeConversation } from './src/conversations';", resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const api = await import(pathToFileURL(bundle).href);
  const migrations = await Promise.all((await readdir(join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFile(join(root, 'migrations', name), 'utf8')));

  function fixture({ provider = 'google' } = {}) {
    const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
    for (const migration of migrations) sqlite.exec(migration);
    sqlite.exec('PRAGMA foreign_keys=ON');
    const state = { dbCalls: 0, executions: [], beforeExecute: null, limiterCalls: [] };
    class Statement {
      constructor(sql, values = []) { this.sql = sql; this.values = values; }
      bind(...values) { return new Statement(this.sql, values); }
      prepared() {
        state.dbCalls++;
        state.beforeExecute?.(this.sql, this.values);
        state.executions.push(this.sql);
        return sqlite.prepare(this.sql);
      }
      async first(column) { const row = this.prepared().get(...this.values); return column ? row?.[column] ?? null : row ?? null; }
      async all() { return { results: this.prepared().all(...this.values), success: true }; }
      async run() {
        const query = this.prepared();
        if (query.columns().length) {
          const results = query.all(...this.values);
          return { results, meta: sqlite.prepare('SELECT changes() changes').get(), success: true };
        }
        return { results: [], meta: query.run(...this.values), success: true };
      }
    }
    const DB = {
      prepare(sql) { state.dbCalls++; return new Statement(sql); },
      async batch(statements) {
        state.dbCalls++; sqlite.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sqlite.exec('COMMIT'); return results;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    const limiter = name => ({ async limit({ key }) { state.limiterCalls.push({ name, key }); return { success: true }; } });
    const env = {
      DB, HOSTED: 'true', PUBLIC_URL: base, AUTH_PROVIDER: provider, SIGNUP_MODE: 'public',
      ENCRYPTION_KEY: randomBytes(32).toString('hex'), AUTH_RATE_LIMITER: limiter('auth'),
      GLOBAL_RATE_LIMITER: limiter('global'), RATE_LIMITER: limiter('workspace'),
      RESOURCE_ESSENTIAL_RESERVE_PERCENT: '0',
      CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from(new URL(issuer).hostname + '$').toString('base64'),
      CLERK_SECRET_KEY: 'sk_test_synthetic_http_boundary_secret', CLERK_ISSUER: issuer,
      CLERK_ALLOW_DEVELOPMENT: 'true', CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_' + webhookKey.toString('base64'),
    };
    function human(label, identityProvider = provider) {
      const id = 'usr_' + random(), workspace = 'ws_' + random(), subject = 'user_' + random(), email = `${label}@example.test`;
      const identity = JSON.stringify([identityProvider, identityProvider === 'clerk' ? issuer : 'https://accounts.google.com', subject]);
      const now = Date.now(), token = 'ses_' + random(), csrf = 'csrf_' + random();
      sqlite.prepare('INSERT INTO workspaces(id,name,created_at,next_release_beta) VALUES (?,?,?,1)').run(workspace, label, now);
      sqlite.prepare('INSERT INTO users(id,google_sub,email,name,workspace_id,created_at,identity_key,identity_hash,identity_checked_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, identityProvider === 'clerk' ? 'clerk:' + hash(identity) : subject, email, label, workspace, now, identity, hash(identity), now);
      if (identityProvider === 'google') sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,csrf_token,created_at,expires_at) VALUES (?,?,?,?,?)')
        .run(hash(token), id, csrf, now, now + 3600000);
      return { id, user: id, workspace, subject, email, csrf, cookie: '__Host-relay_session=' + token };
    }
    const owner = human('owner');
    function agent(id, { person = owner, canRequest = true, canWork = true } = {}) {
      const token = 'key_' + random();
      sqlite.prepare('INSERT INTO agents(id,workspace_id,handle,name,token_hash,platform,can_request,can_work,work_types,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, person.workspace, id, id, hash(token), 'claude', Number(canRequest), Number(canWork), '["task","review"]', Date.now());
      return { id, token, person, workspace: person.workspace };
    }
    function oauth(connection, scopes = allScopes, resource = base + '/mcp') {
      const client = 'client_' + random(), grant = 'grant_' + random(), token = 'access_' + random(), refresh = 'refresh_' + random(), now = Date.now();
      const generation = sqlite.prepare('SELECT auth_generation FROM agents WHERE id=?').get(connection.id).auth_generation;
      sqlite.prepare('INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES (?,?,?,?)').run(client, 'Synthetic HTTP boundary client', '[]', now);
      sqlite.prepare('INSERT INTO oauth_grants(id,user_id,workspace_id,agent_id,auth_generation,client_id,scope,resource,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(grant, connection.person.id, connection.workspace, connection.id, generation, client, scopes.join(' '), resource, now);
      for (const [kind, raw] of [['access', token], ['refresh', refresh]]) sqlite.prepare('INSERT INTO oauth_tokens(token_hash,grant_id,kind,created_at,expires_at) VALUES (?,?,?,?,?)')
        .run(hash(raw), grant, kind, now, now + 3600000);
      return { token, refresh, client, grant, scopes };
    }
    async function request(path, { method = 'GET', token, body, form, raw, cookie, csrf, headers: extra = {} } = {}) {
      const headers = { accept: 'application/json', origin: base, 'cf-connecting-ip': '203.0.113.44', ...extra };
      if (token) headers.authorization = 'Bearer ' + token;
      if (cookie) headers.cookie = cookie;
      if (csrf) headers['x-csrf-token'] = csrf;
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (form !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded';
      const background = [];
      const response = await api.worker.fetch(new Request(base + path, { method, headers,
        body: body !== undefined ? JSON.stringify(body) : form !== undefined ? new URLSearchParams(form) : raw }), env,
      { waitUntil: promise => background.push(promise), passThroughOnException() {} });
      const completed = await Promise.allSettled(background);
      for (const result of completed) assert.equal(result.status, 'fulfilled', 'Background operation failed');
      const text = await response.text(); let data;
      try { data = JSON.parse(text); } catch {}
      return { status: response.status, data, text, headers: response.headers };
    }
    const ownerRequest = (path, options = {}) => request(path, { ...owner, ...options });
    const rpc = (token, name, args = {}) => request('/mcp', { method: 'POST', token,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
    const batch = (token, messages) => request('/mcp', { method: 'POST', token, body: messages });
    const send = async (from, to, message = 'Review the public fixture.', extra = {}) => status(await request('/v1/conversations',
      { method: 'POST', token: from.token, body: { to: to.id, message, ...extra } }), 201);
    const claim = async (to, id, consumer_id = 'run-1') => status(await request(`/v1/requests/${id}/claim`,
      { method: 'POST', token: to.token, body: { consumer_id } }), 200);
    const reply = (to, id, claim_id, message = 'Completed the public fixture.', resultStatus = 'completed') => request(`/v1/requests/${id}/reply`,
      { method: 'POST', token: to.token, body: { claim_id, message, status: resultStatus } });
    async function paired(connection) {
      const encrypted = await api.sealAgentKey(env.ENCRYPTION_KEY, connection.id, connection.token);
      sqlite.prepare('UPDATE agents SET key_ciphertext=? WHERE id=?').run(encrypted, connection.id);
      const code = 'pair_' + randomBytes(12).toString('base64url'), now = Date.now();
      sqlite.prepare('INSERT INTO pairing_codes(code_hash,workspace_id,agent_id,auth_generation,created_at,expires_at) VALUES (?,?,?,1,?,?)')
        .run(hash(code), connection.workspace, connection.id, now, now + 600000);
      const redeemed = status(await request('/v1/pair', { method: 'POST', body: { code } }), 200);
      assert.equal(redeemed.token, connection.token); return connection;
    }
    function counters() { return sqlite.prepare('SELECT scope_type,scope_id,day_used,month_used FROM resource_operation_budgets ORDER BY scope_type,scope_id').all(); }
    return { sqlite, state, env, owner, human, agent, oauth, request, ownerRequest, rpc, batch, send, claim, reply, paired, counters };
  }

  await check('scoped MCP rejects cached generic, other-connection and foreign tokens before GET or POST can touch tools',async()=>{
    const f=fixture(),chat=f.agent('chatgpt'),grok=f.agent('grok'),foreign=f.agent('foreign',{person:f.human('foreign-owner')});
    const path='/mcp/connections/grok',resource=base+path;
    const generic=f.oauth(chat),sameIdentityGeneric=f.oauth(grok),other=f.oauth(chat,allScopes,base+'/mcp/connections/chatgpt'),foreignGrant=f.oauth(foreign,allScopes,base+'/mcp/connections/foreign');
    const rpc={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'connection_status',arguments:{}}};
    const before=f.counters();
    for(const method of ['GET','POST']) for(const token of [undefined,generic.token,sameIdentityGeneric.token,other.token,foreignGrant.token,grok.token]) {
      const denied=await f.request(path,{method,token,...(method==='POST'?{body:rpc}:{})});
      status(denied,401);assert.equal(denied.headers.get('www-authenticate'),`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource${path}"`);
      assert.doesNotMatch(denied.text,/chatgpt|foreign-owner|agent_id|can_request/);
    }
    status(await f.ownerRequest(path,{method:'POST',body:rpc}),401);
    assert.deepEqual(f.counters(),before,'Wrong-target authentication cannot consume relay-operation allowances');
    assert.ok(f.sqlite.prepare('SELECT last_seen_at FROM agents').all().every(agent=>agent.last_seen_at===null),'Wrong-target calls cannot mark any connection as contacted');
    const scoped=f.oauth(grok,allScopes,resource);
    assert.equal(rpcData(await f.request(path,{method:'POST',token:scoped.token,body:rpc})).id,'grok');
    status(await f.request(path,{token:scoped.token}),405);
    assert.equal(status(await f.request('/v1/me',{token:scoped.token}),200).id,'grok');
    status(await f.request('/mcp',{method:'POST',token:scoped.token,body:rpc}),401);
    assert.equal(rpcData(await f.rpc(generic.token,'connection_status')).id,'chatgpt','Existing generic MCP authorization remains usable');
    assert.equal(status(await f.request('/v1/me',{token:grok.token}),200).id,'grok','Existing paired HTTP credentials remain usable');
  });

  await check('connection discovery is public but contains no owner data and cannot reopen credential URLs',async()=>{
    const f=fixture(),connection=f.agent('grok');
    f.sqlite.prepare('UPDATE agents SET name=? WHERE id=?').run('PRIVATE_CONNECTION_NAME','grok');
    const before=f.state.dbCalls;
    for(const id of ['grok','missing-connection']) {
      const metadata=status(await f.request('/.well-known/oauth-protected-resource/mcp/connections/'+id),200);
      assert.equal(metadata.resource,base+'/mcp/connections/'+id);
      assert.deepEqual(metadata.authorization_servers,[base]);
      assert.doesNotMatch(JSON.stringify(metadata),/PRIVATE_CONNECTION_NAME|owner@example|workspace|token/);
    }
    assert.equal(f.state.dbCalls,before,'Public discovery must not look up private identities');
    for(const path of ['/mcp/'+connection.token,'/mcp/connections/grok?key='+connection.token,'/mcp/connections/grok/','/mcp/connections/grok/extra']) {
      status(await f.request(path),401);
    }
    status(await f.request('/mcp/connections/%67rok'),400);
    status(await f.request('/.well-known/oauth-protected-resource/mcp/connections/grok/'),404);
    const metadata=status(await f.request('/.well-known/oauth-protected-resource/mcp'),200);assert.equal(metadata.resource,base+'/mcp');
  });

  await check('scoped grants retain scope, revocation and agent-generation boundaries',async()=>{
    const f=fixture(),grok=f.agent('grok'),path='/mcp/connections/grok',resource=base+path;
    const readOnly=f.oauth(grok,['relay:read'],resource),workOnly=f.oauth(grok,['relay:work'],resource);
    const rpc=name=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}});
    assert.equal(rpcData(await f.request(path,{method:'POST',token:readOnly.token,body:rpc('connection_status')})).can_work,false);
    rpcDenied(await f.request(path,{method:'POST',token:readOnly.token,body:rpc('get_next_job')}));
    rpcDenied(await f.request(path,{method:'POST',token:workOnly.token,body:rpc('connection_status')}));
    const malformed=f.oauth(grok,['relay:read'],base+'/mcp/connections/another');
    status(await f.request('/v1/me',{token:malformed.token}),401);
    status(await f.request(path,{method:'POST',token:malformed.token,body:rpc('connection_status')}),401);
    status(await f.request('/oauth/revoke',{method:'POST',form:{client_id:readOnly.client,token:readOnly.token}}),200);
    status(await f.request(path,{method:'POST',token:readOnly.token,body:rpc('connection_status')}),401);
    f.sqlite.prepare('UPDATE agents SET auth_generation=auth_generation+1 WHERE id=?').run('grok');
    status(await f.request(path,{method:'POST',token:workOnly.token,body:rpc('get_next_job')}),401);
  });

  await check('send-only mutation receipts omit stored results, thread and pins while read/work grants preserve their context', async () => {
    const f = fixture(), sender = f.agent('sender'), receiver = f.agent('receiver');
    const sendOnly = f.oauth(sender, ['relay:send']), readOnly = f.oauth(sender, ['relay:read']), workOnly = f.oauth(receiver, ['relay:work']);
    const message = 'Review the public fixture.', key = 'receipt-replay';
    const sent = await f.send(sender, receiver, message, { idempotency_key: key });
    const id = sent.request.id, cid = sent.conversation.id;
    const secrets = ['PRIVATE_PIN_SENTINEL', 'PRIVATE_QUESTION_SENTINEL', 'PRIVATE_SUMMARY_SENTINEL', 'PRIVATE_BODY_SENTINEL', 'PRIVATE_DATA_SENTINEL'];
    status(await f.ownerRequest(`/v1/conversations/${cid}/context`, { method: 'PATCH', body: { pinned_context: secrets[0], expected_version: 0 } }), 200);
    const first = await f.claim(workOnly, id);
    assert.equal(first.request.conversation_context.pinned_context, secrets[0], 'Work-only pickup needs the complete pinned brief');
    assert.ok(first.configuration, 'Work-only pickup retains current collaboration configuration');
    status(await f.reply(workOnly, id, first.claim_id, secrets[1], 'needs_input'), 200);
    status(await f.request(`/v1/jobs/${id}/reply`, { method: 'POST', token: sender.token, body: { message: 'Use the public scope.' } }), 200);
    const resumed = await f.claim(workOnly, id, 'run-2');
    status(await f.reply(workOnly, id, resumed.claim_id, `## Summary\n${secrets[2]}\n\n${secrets[3]}\n\n\`\`\`json\n{"secret":"${secrets[4]}"}\n\`\`\``), 200);
    const full = status(await f.request(`/v1/jobs/${id}?full=1`, { token: readOnly.token }), 200);
    assert.equal(full.job.result.body.includes(secrets[3]), true);
    assert.equal(full.job.result.data.secret, secrets[4]);
    const history = status(await f.request(`/v1/conversations/${cid}`, { token: readOnly.token }), 200);
    for (const secret of secrets) assert.ok(JSON.stringify(history).includes(secret), `Full read must retain ${secret}`);
    status(await f.request(`/v1/jobs/${id}`, { token: sendOnly.token }), 403);
    const receipts = [
      status(await f.request('/v1/jobs', { method: 'POST', token: sendOnly.token, body: { idempotency_key: key } }), 200),
      status(await f.request(`/v1/jobs/${id}/accept`, { method: 'POST', token: sendOnly.token, body: {} }), 200),
      status(await f.request('/v1/conversations', { method: 'POST', token: sendOnly.token, body: { to: receiver.id, message, idempotency_key: key } }), 200),
      status(await f.request(`/v1/conversations/${cid}/messages`, { method: 'POST', token: sendOnly.token,
        body: { to: receiver.id, message: 'Received.', response_requested: false, idempotency_key: 'safe-note' } }), 201),
      rpcData(await f.rpc(sendOnly.token, 'send_message', { to: receiver.id, message, idempotency_key: key })),
      rpcData(await f.rpc(sendOnly.token, 'send_message', { to: receiver.id, message: 'Received.', conversation_id: cid, response_requested: false, idempotency_key: 'safe-note' })),
    ];
    for (const receipt of receipts) {
      const encoded = JSON.stringify(receipt);
      for (const secret of secrets) assert.equal(encoded.includes(secret), false, `Send-only receipt leaked ${secret}`);
      for (const field of ['result', 'pinned_context', 'conversation_context', 'thread', 'collaboration_configuration']) assert.equal(encoded.includes(`"${field}":`), false, `Send-only receipt included ${field}`);
    }
    const followup = await f.send(sender, receiver, 'Review a follow-up.', { conversation_id: cid });
    const picked = rpcData(await f.rpc(workOnly.token, 'claim_request', { request_id: followup.request.id, consumer_id: 'work-only-mcp' }));
    assert.equal(picked.request.conversation_context.pinned_context, secrets[0]);
    assert.ok(JSON.stringify(picked.request.conversation_context).includes(secrets[2]), 'Work-only MCP pickup must retain prior answers');
  });

  await check('current send/work settings attenuate HTTP and MCP scopes without revoking the OAuth grant or refresh', async () => {
    const f = fixture(), sender = f.agent('sender'), receiver = f.agent('receiver');
    const grant = f.oauth(sender), workerGrant = f.oauth(receiver);
    const sent = await f.send(sender, receiver), held = await f.claim(receiver, sent.request.id);
    status(await f.reply(receiver, sent.request.id, held.claim_id), 200);
    f.sqlite.prepare('UPDATE agents SET can_request=0 WHERE id=?').run(sender.id);
    status(await f.request(`/v1/conversations/${sent.conversation.id}/messages`, { method: 'POST', token: grant.token,
      body: { to: receiver.id, message: 'Denied note', response_requested: false } }), 403);
    status(await f.request(`/v1/jobs/${sent.request.id}/reject`, { method: 'POST', token: grant.token, body: { feedback: 'Denied revision' } }), 403);
    rpcDenied(await f.rpc(grant.token, 'send_message', { to: receiver.id, conversation_id: sent.conversation.id, message: 'Denied note', response_requested: false }));
    rpcDenied(await f.rpc(grant.token, 'send_back', { job_id: sent.request.id, feedback: 'Denied revision' }));
    assert.equal(f.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(sent.request.id).status, 'completed');
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE kind IN ('note','revision')").get().n, 0);
    f.sqlite.prepare('UPDATE agents SET can_work=0 WHERE id=?').run(receiver.id);
    assert.equal(status(await f.request('/v1/me', { token: workerGrant.token }), 200).can_work, false);
    status(await f.request(`/v1/requests/${sent.request.id}/claim`, { method: 'POST', token: workerGrant.token, body: { consumer_id: 'denied' } }), 403);
    rpcDenied(await f.rpc(workerGrant.token, 'claim_request', { request_id: sent.request.id, consumer_id: 'denied' }));
    for (const current of [grant, workerGrant]) {
      assert.equal(f.sqlite.prepare('SELECT revoked_at FROM oauth_grants WHERE id=?').get(current.grant).revoked_at, null);
      const refreshed = status(await f.request('/oauth/token', { method: 'POST', form: { grant_type: 'refresh_token', client_id: current.client,
        refresh_token: current.refresh, resource: base + '/mcp' } }), 200);
      assert.ok(refreshed.access_token && refreshed.refresh_token);
      const me = status(await f.request('/v1/me', { token: refreshed.access_token }), 200);
      assert.equal(current === grant ? me.can_request : me.can_work, false, 'A refreshed grant must retain current attenuation');
      assert.equal(f.sqlite.prepare('SELECT scope FROM oauth_grants WHERE id=?').get(current.grant).scope, allScopes.join(' '));
    }
  });

  for (const restriction of ['banned', 'locked', 'unverified', 'invite_removed']) {
    await check(`${restriction} blocks actual paired-key HTTP/MCP while another workspace stays usable`, async () => {
      const f = fixture({ provider: restriction === 'invite_removed' ? 'google' : 'clerk' });
      const first = await f.paired(f.agent('paired-owner')), neighborPerson = f.human('neighbor'), neighbor = await f.paired(f.agent('paired-neighbor', { person: neighborPerson }));
      status(await f.request('/v1/me', { token: first.token }), 200);
      rpcData(await f.rpc(first.token, 'connection_status'));
      if (restriction === 'invite_removed') {
        f.env.SIGNUP_MODE = 'invite'; f.env.BETA_EMAILS = neighborPerson.email;
      } else {
        const timestamp = Math.floor(Date.now() / 1000), eventId = 'msg_' + random();
        const data = { id: f.owner.subject, primary_email_address_id: 'email_primary', banned: restriction === 'banned', locked: restriction === 'locked',
          email_addresses: [{ id: 'email_primary', email_address: f.owner.email, verification: { status: restriction === 'unverified' ? 'unverified' : 'verified' } }] };
        const raw = JSON.stringify({ object: 'event', type: 'user.updated', data, timestamp: timestamp * 1000 });
        const signature = createHmac('sha256', webhookKey).update(`${eventId}.${timestamp}.${raw}`).digest('base64');
        status(await f.request('/auth/clerk/webhook', { method: 'POST', raw, headers: { 'content-type': 'application/json', 'svix-id': eventId,
          'svix-timestamp': String(timestamp), 'svix-signature': 'v1,' + signature } }), 200);
      }
      status(await f.request('/v1/me', { token: first.token }), 401);
      status(await f.rpc(first.token, 'connection_status'), 401);
      status(await f.request('/v1/me', { token: neighbor.token }), 200);
      assert.equal(rpcData(await f.rpc(neighbor.token, 'connection_status')).id, neighbor.id);
      assert.equal(f.sqlite.prepare('SELECT identity_restricted FROM workspaces WHERE id=?').get(f.owner.workspace).identity_restricted, 1);
      assert.equal(f.sqlite.prepare('SELECT identity_restricted FROM workspaces WHERE id=?').get(neighborPerson.workspace).identity_restricted, 0);
    });
  }

  await check('cheap ingress denial reaches neither D1 authentication nor D1 admission on public hosts', async () => {
    for (const binding of ['AUTH_RATE_LIMITER', 'GLOBAL_RATE_LIMITER']) {
      const f = fixture(); let attempts = 0;
      f.env[binding] = { async limit() { attempts++; return { success: false }; } };
      const requests = [
        ['/v1/me', { token: 'access_unknown' }],
        ['/mcp', { method: 'POST', token: 'unknown-key', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }],
        ['/oauth/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: 'invalid', client_id: 'invalid' } }],
        ['/oauth/register', { method: 'POST', body: { client_name: 'invalid', redirect_uris: ['https://client.example.test/callback'] } }],
        ['/auth/session', { cookie: '__Host-relay_session=unknown' }],
        ['/v1/pair', { method: 'POST', body: { code: 'pair_AAAAAAAAAAAAAAAA' } }],
      ];
      for (const [path, options] of requests) {
        const before = f.state.dbCalls;
        assert.equal(status(await f.request(path, options), 429).error.code, 'rate_limited');
        assert.equal(f.state.dbCalls, before, `${binding} denial touched D1 for ${path}`);
      }
      assert.equal(attempts, requests.length);
    }
  });

  await check('global/workspace daily and monthly exhaustion is enforced at actual HTTP routes', async () => {
    for (const scope of ['GLOBAL', 'WORKSPACE']) for (const period of ['DAILY', 'MONTHLY']) {
      const f = fixture(), sender = f.agent('sender'), receiver = f.agent('receiver');
      const before = f.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n;
      f.env[`RESOURCE_${scope}_${period}_OPERATIONS`] = '0';
      for (const [path, options] of [
        ['/v1/me', { token: sender.token }],
        ['/v1/conversations', { method: 'POST', token: sender.token, body: { to: receiver.id, message: 'Must not be created' } }],
      ]) {
        const response = await f.request(path, options);
        assert.equal(status(response, 429).error.code, scope.toLowerCase() + '_budget_exhausted');
        assert.ok(Number(response.headers.get('retry-after')) > 0);
      }
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n, before);
    }
  });

  await check('MCP batches charge each operation and deny later messages when the workspace allowance is exhausted', async () => {
    const f = fixture(), sender = f.agent('sender'), grant = f.oauth(sender);
    const item = id => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'connection_status', arguments: {} } });
    f.sqlite.exec('DELETE FROM resource_operation_budgets');
    const first = status(await f.batch(grant.token, [item(1), item(2), item(3)]), 200);
    assert.equal(first.length, 3); for (const value of first) assert.equal(value.result?.isError, false, JSON.stringify(value));
    let rows = f.counters();
    assert.equal(rows.find(row => row.scope_type === 'workspace').day_used, 3, 'A batch is not one workspace operation');
    assert.equal(rows.find(row => row.scope_type === 'global').day_used, 3, 'Only authenticated operations spend the shared work allowance');
    f.env.RESOURCE_WORKSPACE_DAILY_OPERATIONS = '4';
    const second = status(await f.batch(grant.token, [item(4), item(5)]), 200);
    assert.equal(second[0].result?.isError, false, 'The final operation slot should remain useful');
    assert.equal(second[1].result?.isError, true); assert.match(JSON.stringify(second[1]), /workspace_budget_exhausted/);
    rows = f.counters(); assert.equal(rows.find(row => row.scope_type === 'workspace').day_used, 4);
    assert.equal(rows.find(row => row.scope_type === 'global').day_used, 4, 'Denied message must not charge either counter');
    f.env.RESOURCE_GLOBAL_DAILY_OPERATIONS = '4';delete f.env.RESOURCE_WORKSPACE_DAILY_OPERATIONS;
    const denied=status(await f.batch(grant.token,[item(6)]),200);
    assert.equal(denied[0].result.isError,true);assert.match(JSON.stringify(denied[0]),/global_budget_exhausted/);
    assert.deepEqual(f.counters(),rows);
  });

  await check('100 held-claim retries retain at most four claims and one resend event with the original capability valid', async () => {
    const f = fixture(), sender = f.agent('sender'), receiver = f.agent('receiver');
    const sent = await f.send(sender, receiver), original = await f.claim(receiver, sent.request.id, 'same-execution');
    assert.ok(original.claim_id);
    for (let i = 0; i < 100; i++) {
      const retry = await f.claim(receiver, sent.request.id, 'same-execution');
      assert.equal(retry.resent, true); assert.ok(retry.claim_id); assert.equal(retry.request.id, sent.request.id);
      assert.ok(f.sqlite.prepare('SELECT COUNT(*) n FROM claims WHERE job_id=?').get(sent.request.id).n <= 4);
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM claims WHERE job_id=?').get(sent.request.id).n, 4);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE job_id=? AND kind='claim_resent'").get(sent.request.id).n, 1);
    assert.equal(f.sqlite.prepare('SELECT attempts FROM jobs WHERE id=?').get(sent.request.id).attempts, 1);
    assert.equal(status(await f.reply(receiver, sent.request.id, original.claim_id), 200).outcome, 'ACCEPTED');
  });

  await check('100 accept retries per completed attempt retain one accepted event and the actual result', async () => {
    const f = fixture(), sender = f.agent('sender'), receiver = f.agent('receiver');
    const sent = await f.send(sender, receiver), id = sent.request.id;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const held = await f.claim(receiver, id, `attempt-${attempt}`), answer = `Retained answer for attempt ${attempt}.`;
      status(await f.reply(receiver, id, held.claim_id, answer), 200);
      for (let retry = 0; retry < 100; retry++) {
        const accepted = status(await f.request(`/v1/jobs/${id}/accept`, { method: 'POST', token: sender.token, body: {} }), 200);
        assert.equal(accepted.job.status, 'completed');
        assert.equal(accepted.job.result.summary, answer);
      }
      const receipts = f.sqlite.prepare("SELECT detail FROM events WHERE job_id=? AND kind='accepted'").all(id);
      assert.equal(receipts.length, attempt, 'A successful attempt adds exactly one audit receipt with available space');
      assert.equal(receipts.filter(row => JSON.parse(row.detail).attempt === attempt).length, 1);
      assert.equal(status(await f.request(`/v1/jobs/${id}?full=1`, { token: sender.token }), 200).job.result.body, answer);
      if (attempt === 1) status(await f.request(`/v1/jobs/${id}/reject`, { method: 'POST', token: sender.token, body: { feedback: 'Revise once.' } }), 200);
    }
  });

  for (const capacity of ['exactly full', 'over limit']) {
    for (const action of ['cancel', 'stop', 'revoke OAuth', 'revoke activation', 'disconnect']) {
      await check(`${action} succeeds with accounted storage ${capacity} and existing full results remain readable`, async () => {
        const f = fixture(), sender = f.agent('sender'), receiver = f.agent('receiver');
        const receiverGrant = f.oauth(receiver), readerGrant = f.oauth(sender, ['relay:read']);
        const completed = await f.send(sender, receiver, 'Keep this finished result.'), done = await f.claim(receiver, completed.request.id);
        const retainedBody = 'This completed result must remain fully available at the storage limit.';
        status(await f.reply(receiver, completed.request.id, done.claim_id, retainedBody), 200);
        const pending = await f.send(sender, receiver, 'Stop this pending work.'), held = await f.claim(receiver, pending.request.id);
        if (action === 'revoke activation') {
          const now = Date.now();
          f.sqlite.prepare('INSERT INTO activation_configs(workspace_id,agent_id,endpoint,token_ciphertext,enabled,created_at,updated_at) VALUES (?,?,?,?,1,?,?)')
            .run(receiver.workspace, receiver.id, 'https://api.anthropic.com/v1/claude_code/routines/trig_synthetic/fire', 'synthetic-encrypted-activation-token', now, now);
          f.sqlite.prepare("INSERT INTO activation_dispatches(id,workspace_id,job_id,agent_id,generation,config_revision,status,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,1,'pending',?,?,?)")
            .run('act_cleanup', receiver.workspace, pending.request.id, receiver.id, '1:0', now, now, now);
        }
        const usage = f.sqlite.prepare('SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=?').get(f.owner.workspace).accounted_bytes;
        const limit = capacity === 'exactly full' ? usage : Math.max(1, usage - 16384);
        f.sqlite.prepare('UPDATE workspaces SET storage_limit_bytes=? WHERE id=?').run(limit, f.owner.workspace);
        assert.equal(f.sqlite.prepare('SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=?').get(f.owner.workspace).accounted_bytes, usage);
        assert.ok(capacity === 'exactly full' ? usage === limit : usage > limit);
        const readRetainedResult = async () => {
          const result = status(await f.request(`/v1/jobs/${completed.request.id}?full=1`, { token: readerGrant.token }), 200).job;
          assert.equal(result.status, 'completed'); assert.equal(result.result.body, retainedBody);
        };
        await readRetainedResult();
        if (action === 'cancel') {
          const canceled = status(await f.ownerRequest(`/v1/jobs/${pending.request.id}/cancel`, { method: 'POST', body: {} }), 200);
          assert.equal(canceled.job.status, 'canceled');
        } else if (action === 'stop') {
          const stopped = status(await f.ownerRequest(`/v1/conversations/${pending.conversation.id}/stop`, { method: 'POST', body: {} }), 200);
          assert.ok(stopped.conversation.stopped_at);
          assert.ok(f.sqlite.prepare('SELECT stopped_at FROM conversation_chains WHERE workspace_id=? AND root_id=?').get(f.owner.workspace, pending.request.chain_root_id).stopped_at);
          assert.ok(f.sqlite.prepare('SELECT revoked_at FROM claims WHERE token_hash=?').get(hash(held.claim_id)).revoked_at);
        } else if (action === 'revoke OAuth') {
          status(await f.ownerRequest('/auth/grants', { method: 'POST', body: { id: receiverGrant.grant } }), 200);
          assert.ok(f.sqlite.prepare('SELECT revoked_at FROM oauth_grants WHERE id=?').get(receiverGrant.grant).revoked_at);
          status(await f.request('/v1/me', { token: receiverGrant.token }), 401);
          status(await f.request('/oauth/token', { method: 'POST', form: { grant_type: 'refresh_token', client_id: receiverGrant.client,
            refresh_token: receiverGrant.refresh, resource: base + '/mcp' } }), 400);
        } else if (action === 'revoke activation') {
          status(await f.ownerRequest(`/v1/agents/${receiver.id}/activation`, { method: 'DELETE' }), 200);
          const config = f.sqlite.prepare('SELECT enabled,token_ciphertext FROM activation_configs WHERE workspace_id=? AND agent_id=?').get(receiver.workspace, receiver.id);
          assert.equal(config.enabled, 0); assert.equal(config.token_ciphertext, null);
          assert.equal(f.sqlite.prepare("SELECT status FROM activation_dispatches WHERE id='act_cleanup'").get().status, 'canceled');
        } else {
          const disconnected = await f.ownerRequest(`/v1/admin/agents/${receiver.id}`, { method: 'DELETE' });
          assert.equal(disconnected.status, 200, JSON.stringify({ response: disconnected.data,
            agent_still_present: !!f.sqlite.prepare('SELECT id FROM agents WHERE id=?').get(receiver.id),
            job_status: f.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(pending.request.id).status,
            claim_revoked_at: f.sqlite.prepare('SELECT revoked_at FROM claims WHERE token_hash=?').get(hash(held.claim_id))?.revoked_at }));
          assert.equal(f.sqlite.prepare('SELECT id FROM agents WHERE id=?').get(receiver.id), undefined);
          status(await f.request('/v1/me', { token: receiver.token }), 401);
          status(await f.request('/v1/me', { token: receiverGrant.token }), 401);
        }
        if (['cancel', 'stop', 'disconnect'].includes(action)) {
          const actual = f.sqlite.prepare('SELECT status,lease_holder,lease_id FROM jobs WHERE id=?').get(pending.request.id);
          assert.equal(actual.status, 'canceled', 'Skipping an optional event must not hide a failed status transition');
          assert.equal(actual.lease_holder, null); assert.equal(actual.lease_id, null);
        }
        await readRetainedResult();
      });
    }
  }

  for (const capacity of ['available', 'partial event group', 'shared over limit']) {
    await check(`multi-job disconnect preserves cancellation and broadcast recovery with audit space ${capacity}`, async () => {
      const f = fixture(), sender = f.agent('sender'), receiver = f.agent('receiver');
      f.sqlite.prepare('UPDATE agents SET max_leases=4 WHERE id=?').run(receiver.id);
      const first = await f.send(sender, receiver, 'First directed request.'), second = await f.send(sender, receiver, 'Second directed request.');
      const directed = await f.claim(receiver, first.request.id);
      const broadcasts = [];
      for (const max_attempts of [2, 1]) {
        const created = status(await f.request('/v1/jobs', { method: 'POST', token: sender.token,
          body: { to: '*', type: 'task', title: 'Broadcast cleanup fixture', goal: 'Cleanly release this work.', max_attempts } }), 201);
        const held = status(await f.request(`/v1/work/next?job_id=${created.job.id}`, { method: 'POST', token: receiver.token }), 200);
        assert.equal(held.job.id, created.job.id); assert.ok(held.claim_id);
        broadcasts.push({ id: created.job.id, token: held.claim_id, max_attempts });
      }
      const usage = () => f.sqlite.prepare('SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=?').get(f.owner.workspace).accounted_bytes;
      if (capacity === 'partial event group') {
        const before = usage();
        f.sqlite.exec('SAVEPOINT cleanup_capacity');
        f.sqlite.prepare('DELETE FROM agents WHERE id=?').run(receiver.id);
        const freed = before - usage();
        f.sqlite.exec('ROLLBACK TO cleanup_capacity'); f.sqlite.exec('RELEASE cleanup_capacity');
        // After the mandatory deletion there is room for one conservative audit
        // receipt, but not either two-event group. The whole group must be skipped.
        f.sqlite.prepare('UPDATE workspaces SET storage_limit_bytes=? WHERE id=?').run(before - freed + 7000, f.owner.workspace);
      } else if (capacity === 'shared over limit') {
        const sharedLimit = 1536 * 1024 * 1024;
        f.sqlite.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)').run('shared-capacity-fixture', 'Shared capacity fixture', Date.now());
        const total = f.sqlite.prepare("SELECT SUM(accounted_bytes) n FROM workspace_storage_usage WHERE workspace_id<>'default'").get().n;
        f.sqlite.prepare('UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes+? WHERE workspace_id=?')
          .run(sharedLimit + 16384 - total, 'shared-capacity-fixture');
      }
      status(await f.ownerRequest(`/v1/admin/agents/${receiver.id}`, { method: 'DELETE' }), 200);
      assert.equal(f.sqlite.prepare('SELECT id FROM agents WHERE id=?').get(receiver.id), undefined);
      for (const id of [first.request.id, second.request.id]) {
        assert.equal(f.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(id).status, 'canceled');
        assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE job_id=? AND kind='canceled'").get(id).n, capacity === 'available' ? 1 : 0);
      }
      for (const broadcast of broadcasts) {
        const expected = broadcast.max_attempts === 1 ? 'failed' : 'queued';
        const row = f.sqlite.prepare('SELECT status,lease_holder,lease_id FROM jobs WHERE id=?').get(broadcast.id);
        assert.equal(row.status, expected); assert.equal(row.lease_holder, null); assert.equal(row.lease_id, null);
        const kind = expected === 'failed' ? 'failed' : 'lease_expired';
        assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM events WHERE job_id=? AND kind=?').get(broadcast.id, kind).n, capacity === 'available' ? 1 : 0);
      }
      for (const token of [directed.claim_id, ...broadcasts.map(item => item.token)]) {
        assert.ok(f.sqlite.prepare('SELECT revoked_at FROM claims WHERE token_hash=?').get(hash(token)).revoked_at);
      }
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE kind='agent_removed' AND json_extract(detail,'$.agent')=?").get(receiver.id).n,
        capacity === 'shared over limit' ? 0 : 1, 'Retain the normal disconnect receipt whenever its guarded space exists');
    });
  }

  await check('missing hosted limiter bindings fail closed on public HTTP/MCP before any D1 call', async () => {
    for (const binding of ['AUTH_RATE_LIMITER', 'GLOBAL_RATE_LIMITER', 'RATE_LIMITER']) {
      const f = fixture(); delete f.env[binding];
      for (const [path, options] of [
        ['/v1/me', { token: 'unknown-key' }],
        ['/mcp', { method: 'POST', token: 'access_unknown', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }],
        ['/auth/session', {}],
        ['/oauth/register', { method: 'POST', body: { redirect_uris: ['https://client.example.test/callback'] } }],
        ['/v1/pair', { method: 'POST', body: { code: 'pair_AAAAAAAAAAAAAAAA' } }],
      ]) {
        const before = f.state.dbCalls;
        assert.equal(status(await f.request(path, options), 503).error.code, 'setup_required');
        assert.equal(f.state.dbCalls, before, `Missing ${binding} must reject ${path} before D1`);
      }
    }
  });

  await check('signed Clerk restriction webhook still revokes capabilities when every operation allowance is exhausted', async () => {
    const f = fixture({ provider: 'clerk' }), receiver = await f.paired(f.agent('receiver')), grant = f.oauth(receiver);
    for (const scope of ['GLOBAL', 'WORKSPACE']) for (const period of ['DAILY', 'MONTHLY']) f.env[`RESOURCE_${scope}_${period}_OPERATIONS`] = '0';
    assert.equal(status(await f.request('/v1/me', { token: receiver.token }), 429).error.code, 'global_budget_exhausted');
    const timestamp = Math.floor(Date.now() / 1000), eventId = 'msg_' + random();
    const data = { id: f.owner.subject, primary_email_address_id: 'email_primary', banned: true, locked: false,
      email_addresses: [{ id: 'email_primary', email_address: f.owner.email, verification: { status: 'verified' } }] };
    const raw = JSON.stringify({ object: 'event', type: 'user.updated', data, timestamp: timestamp * 1000 });
    const signature = createHmac('sha256', webhookKey).update(`${eventId}.${timestamp}.${raw}`).digest('base64');
    const beforeCounters = f.counters();
    status(await f.request('/auth/clerk/webhook', { method: 'POST', raw, headers: { 'content-type': 'application/json', 'svix-id': eventId,
      'svix-timestamp': String(timestamp), 'svix-signature': 'v1,' + signature } }), 200);
    assert.equal(f.sqlite.prepare('SELECT identity_restricted FROM workspaces WHERE id=?').get(f.owner.workspace).identity_restricted, 1);
    assert.ok(f.sqlite.prepare('SELECT revoked_at FROM oauth_grants WHERE id=?').get(grant.grant).revoked_at);
    assert.deepEqual(f.counters(), beforeCounters, 'Security webhook must not consume an exhausted ordinary operation allowance');
    for (const scope of ['GLOBAL', 'WORKSPACE']) for (const period of ['DAILY', 'MONTHLY']) delete f.env[`RESOURCE_${scope}_${period}_OPERATIONS`];
    status(await f.request('/v1/me', { token: receiver.token }), 401);
    status(await f.rpc(grant.token, 'connection_status'), 401);
  });

  await check('100 receipt consumer IDs stop at eight; independent cursors and no-op acknowledgments remain safe', async () => {
    const f = fixture(), sender = f.agent('sender'), receiver = f.agent('receiver');
    const sent = await f.send(sender, receiver), held = await f.claim(receiver, sent.request.id);
    status(await f.reply(receiver, sent.request.id, held.claim_id), 200);
    const page = status(await f.request(`/v1/conversations/${sent.conversation.id}`, { token: sender.token }), 200), cursor = page.next_cursor;
    const ack = (consumer_id, value = cursor) => f.request(`/v1/conversations/${sent.conversation.id}/acknowledge`,
      { method: 'POST', token: sender.token, body: { consumer_id, cursor: value } });
    status(await ack('consumer-0'), 200);
    assert.equal(status(await f.request('/v1/conversations/inbox?consumer_id=consumer-0', { token: sender.token }), 200).conversations.length, 0);
    assert.equal(status(await f.request('/v1/conversations/inbox?consumer_id=consumer-1', { token: sender.token }), 200).conversations.length, 1);
    for (let i = 1; i < 100; i++) {
      const response = await ack('consumer-' + i);
      if (i < 8) status(response, 200);
      else assert.equal(status(response, 429).error.code, 'consumer_limit');
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM conversation_receipts WHERE agent_id=?').get(sender.id).n, 8);
    status(await ack('consumer-0'), 200); status(await ack('consumer-1'), 200);
    // HTTP admission intentionally spends operations even on retries. Isolate
    // the shared acknowledgment mutation to prove its no-op causes no D1 writes.
    const before = f.sqlite.prepare('SELECT total_changes() n').get().n;
    const senderRow = f.sqlite.prepare('SELECT * FROM agents WHERE id=?').get(sender.id);
    await api.acknowledgeConversation({ ...f.env, WORKSPACE_ID: sender.workspace }, senderRow, sent.conversation.id, 'consumer-0', cursor, Date.now() + 1000);
    await api.acknowledgeConversation({ ...f.env, WORKSPACE_ID: sender.workspace }, senderRow, sent.conversation.id, 'consumer-0', sent.message.id, Date.now() + 2000);
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n, before, 'Same or older cursor must perform zero storage changes');
  });

  for (const action of ['note', 'reject', 'reply']) {
    await check(`${action} SQL fences a permission change after authentication and lookup`, async () => {
      const f = fixture(), sender = f.agent('sender'), receiver = f.agent('receiver'), grant = f.oauth(sender);
      const sent = await f.send(sender, receiver), held = await f.claim(receiver, sent.request.id);
      status(await f.reply(receiver, sent.request.id, held.claim_id, 'Fixture answer', action === 'reply' ? 'needs_input' : 'completed'), 200);
      const before = f.sqlite.prepare('SELECT status,result,thread,clarification_rounds FROM jobs WHERE id=?').get(sent.request.id);
      const messagesBefore = f.sqlite.prepare('SELECT COUNT(*) n FROM conversation_messages').get().n;
      let injected = false;
      f.state.beforeExecute = sql => {
        const target = action === 'note' ? sql.startsWith('INSERT INTO conversation_messages(') && sql.includes("'note'")
          : action === 'reject' ? sql.startsWith("UPDATE jobs SET status='queued', result=NULL")
            : sql.startsWith("UPDATE jobs SET status='queued', clarification_rounds");
        if (injected || !target) return;
        injected = true;
        f.sqlite.prepare('UPDATE agents SET can_request=0 WHERE id=?').run(sender.id);
      };
      const response = action === 'note'
        ? await f.request(`/v1/conversations/${sent.conversation.id}/messages`, { method: 'POST', token: grant.token, body: { to: receiver.id, message: 'Must not persist', response_requested: false } })
        : await f.request(`/v1/jobs/${sent.request.id}/${action}`, { method: 'POST', token: grant.token, body: { message: 'Must not persist', feedback: 'Must not persist' } });
      assert.equal(injected, true, 'Race fixture must interleave at the real mutation');
      assert.ok(response.status === 403 || response.status === 409, response.text);
      assert.deepEqual(f.sqlite.prepare('SELECT status,result,thread,clarification_rounds FROM jobs WHERE id=?').get(sent.request.id), before);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM conversation_messages').get().n, messagesBefore);
    });
  }

  await check('encoded endpoint aliases are rejected before ingress counters or database authentication', async () => {
    const f=fixture();
    for(const path of ['/%761/me','/%61uth/config','/%6fauth/register','/%6dcp']) {
      const calls=f.state.dbCalls, limits=f.state.limiterCalls.length;
      assert.equal(status(await f.request(path,{token:'unknown-token'}),400).error.code,'noncanonical_path');
      assert.equal(f.state.dbCalls,calls); assert.equal(f.state.limiterCalls.length,limits);
    }
  });

  await check('an IP already at its ingress limit cannot consume the shared edge bucket', async () => {
    const f=fixture();let globalCalls=0;
    f.env.AUTH_RATE_LIMITER={limit:async()=>({success:false})};
    f.env.GLOBAL_RATE_LIMITER={limit:async()=>{globalCalls++;return {success:true};}};
    const before=f.state.dbCalls;
    for(let i=0;i<20;i++) status(await f.request('/v1/me',{token:'unknown-token'}),429);
    assert.equal(globalCalls,0);assert.equal(f.state.dbCalls,before);
    f.env.AUTH_RATE_LIMITER={limit:async()=>({success:true})};
    status(await f.ownerRequest('/v1/admin/workspace'),200); assert.equal(globalCalls,1);
  });

  await check('anonymous exhaustion and invalid credentials cannot drain authenticated work capacity', async () => {
    const f=fixture(),sender=f.agent('sender'),grant=f.oauth(sender);
    f.env.RESOURCE_ANONYMOUS_DAILY_OPERATIONS='0';f.env.RESOURCE_ANONYMOUS_MONTHLY_OPERATIONS='0';
    for(let i=0;i<10;i++) status(await f.request('/v1/me',{token:'unknown-'+i}),401);
    status(await f.request('/auth/config'),200);
    assert.deepEqual(f.counters(),[]);
    assert.equal(status(await f.request('/oauth/register',{method:'POST',body:{redirect_uris:['https://client.example.test/callback'],client_name:'Fixture client'}}),429).error,'anonymous_budget_exhausted');
    status(await f.request('/v1/me',{token:sender.token}),200);
    status(await f.request('/oauth/token',{method:'POST',form:{grant_type:'refresh_token',client_id:grant.client,refresh_token:grant.refresh,resource:base+'/mcp'}}),200);
    assert.ok(f.counters().every(row=>row.day_used===2),'Only the verified API read and refresh should cost normal work units');
  });

  await check('owner inspection charges its bounded lane from the first call without consuming agent work', async () => {
    const f=fixture(),sender=f.agent('sender');
    for(let i=0;i<25;i++) {
      status(await f.ownerRequest('/v1/admin/overview'),200);
      status(await f.ownerRequest('/v1/agents/sender/collaboration'),200);
    }
    assert.deepEqual(f.counters(),[], 'Dashboard refreshes must not spend either normal work counter');
    const ownerRows=()=>f.sqlite.prepare("SELECT scope_type,scope_id,day_used,month_used FROM resource_lane_budgets WHERE lane='owner' ORDER BY scope_type,scope_id").all();
    const before=ownerRows();
    assert.equal(before.length,2);assert.ok(before.every(row=>row.day_used===50&&row.month_used===50));
    status(await f.request('/v1/me',{token:sender.token}),200);
    status(await f.request('/v1/admin/overview',{token:sender.token}),403);
    assert.ok(f.counters().every(row=>row.day_used===2));assert.deepEqual(ownerRows(),before);
    for(const setting of ['RESOURCE_OWNER_WORKSPACE_DAILY_OPERATIONS','RESOURCE_OWNER_GLOBAL_DAILY_OPERATIONS']) {
      f.env[setting]='50';
      const expected=setting.includes('_WORKSPACE_')?'owner_workspace_budget_exhausted':'owner_global_budget_exhausted';
      assert.equal(status(await f.ownerRequest('/v1/admin/overview'),429).error.code,expected);
      assert.deepEqual(ownerRows(),before);assert.ok(f.counters().every(row=>row.day_used===2));
      delete f.env[setting];
    }
    status(await f.request('/v1/me',{token:sender.token}),200);
    assert.ok(f.counters().every(row=>row.day_used===3));
  });

  await check('owner metadata and setup remain writable at exhausted work capacity without granting agents the owner lane', async () => {
    const f=fixture(),sender=f.agent('sender');
    f.env.RESOURCE_WORKSPACE_DAILY_OPERATIONS='0';
    const routes=[
      ['PUT','/v1/agents/sender/collaboration',{expected_version:0,purpose:'Saved during recovery',background:{method:'manual'},instructions:{custom_prompt:'Keep work bounded.'}}],
      ['PATCH','/v1/agents/sender/onboarding',{step:'connect'}],
      ['POST','/v1/admin/agents/sender/setup',{}],
      ['POST','/v1/admin/agents/sender/pairing',{}],
      ['PUT','/v1/workspace/release',{enabled:false}],
    ];
    for(const [method,path,body] of routes)status(await f.ownerRequest(path,{method,body}),200);
    const saved=JSON.parse(f.sqlite.prepare('SELECT settings FROM agent_collaboration WHERE agent_id=?').get(sender.id).settings);
    assert.equal(saved.purpose,'Saved during recovery');assert.equal(saved.background.method,'manual');
    assert.equal(saved.instructions.custom_prompt,'Keep work bounded.');
    assert.equal(f.sqlite.prepare('SELECT step FROM agent_onboarding WHERE agent_id=?').get(sender.id).step,'connect');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM pairing_codes WHERE agent_id=?').get(sender.id).n,1);
    assert.equal(f.sqlite.prepare('SELECT next_release_beta FROM workspaces WHERE id=?').get(sender.workspace).next_release_beta,0);
    assert.deepEqual(f.counters(),[]);
    const ownerRows=()=>f.sqlite.prepare("SELECT scope_type,scope_id,day_used,month_used FROM resource_lane_budgets WHERE lane='owner' ORDER BY scope_type,scope_id").all();
    const ownerBefore=ownerRows();
    assert.equal(ownerBefore.length,2);assert.ok(ownerBefore.every(row=>row.day_used===50&&row.month_used===50));
    for(const [method,path,body] of routes)assert.equal(status(await f.request(path,{method,body,token:sender.token}),429).error.code,'workspace_budget_exhausted');
    assert.deepEqual(f.counters(),[]);assert.deepEqual(ownerRows(),ownerBefore);
    f.env.RESOURCE_WORKSPACE_DAILY_OPERATIONS='100';
    for(const [method,path,body] of routes)assert.equal(status(await f.request(path,{method,body,token:sender.token}),403).error.code,'owner_only');
    assert.ok(f.counters().every(row=>row.day_used===50));assert.deepEqual(ownerRows(),ownerBefore);
    f.env.RESOURCE_OWNER_WORKSPACE_DAILY_OPERATIONS='50';
    assert.equal(status(await f.ownerRequest('/v1/workspace/release',{method:'PUT',body:{enabled:true}}),429).error.code,'owner_workspace_budget_exhausted');
    assert.equal(f.sqlite.prepare('SELECT next_release_beta FROM workspaces WHERE id=?').get(sender.workspace).next_release_beta,0);
    assert.deepEqual(ownerRows(),ownerBefore);
    for(const table of ['jobs','schedules','activation_dispatches'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  });

  await check('identity and own configuration use the finite reserve while generic reads and new work stay blocked', async () => {
    const f=fixture(),sender=f.agent('sender'),receiver=f.agent('receiver'),grant=f.oauth(sender);
    f.env.RESOURCE_ESSENTIAL_RESERVE_PERCENT='10';
    f.env.RESOURCE_WORKSPACE_DAILY_OPERATIONS='100';f.env.RESOURCE_WORKSPACE_MONTHLY_OPERATIONS='100';
    status(await f.request('/v1/me',{token:sender.token}),200);
    f.sqlite.prepare("UPDATE resource_operation_budgets SET day_used=90,month_used=90 WHERE scope_type='workspace'").run();
    assert.equal(status(await f.request('/v1/me',{token:sender.token}),200).id,sender.id);
    status(await f.request('/v1/configuration',{token:sender.token}),200);
    assert.equal(rpcData(await f.rpc(grant.token,'connection_status')).id,sender.id);
    rpcData(await f.rpc(grant.token,'get_collaboration_config'));
    assert.equal(f.counters().find(row=>row.scope_type==='workspace').day_used,94);
    const before=f.counters();
    assert.equal(status(await f.request('/v1/jobs',{token:sender.token}),429).error.code,'workspace_budget_exhausted');
    assert.equal(status(await f.request('/v1/conversations',{method:'POST',token:sender.token,body:{to:receiver.id,message:'No bypass'}}),429).error.code,'workspace_budget_exhausted');
    for(const tool of ['list_agents','list_conversations']) {
      const denied=await f.rpc(grant.token,tool);rpcDenied(denied);assert.match(denied.text,/workspace_budget_exhausted/);
    }
    assert.deepEqual(f.counters(),before);
    f.sqlite.prepare("UPDATE resource_operation_budgets SET day_used=100,month_used=100 WHERE scope_type='workspace'").run();
    const full=f.counters();
    for(const path of ['/v1/me','/v1/configuration'])assert.equal(status(await f.request(path,{token:sender.token}),429).error.code,'workspace_budget_exhausted');
    for(const tool of ['connection_status','get_collaboration_config']) {
      const denied=await f.rpc(grant.token,tool);rpcDenied(denied);assert.match(denied.text,/workspace_budget_exhausted/);
    }
    assert.deepEqual(f.counters(),full);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM resource_lane_budgets').get().n,0,'Agent identity cannot use an owner or anonymous lane');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n,0);
  });

  await check('owner credentials cannot use the control lane for polling, claims or new work', async () => {
    const f=fixture(),sender=f.agent('sender');
    f.env.RESOURCE_WORKSPACE_DAILY_OPERATIONS='0';
    const routes=[['GET','/v1/work/next'],['POST','/v1/work/next'],['HEAD','/v1/work/next'],
      ['GET','/v1/inbox'],['GET','/v1/conversations/inbox'],['GET','/v1/requests/pending'],
      ['POST','/v1/requests/request-id/claim'],['POST','/v1/jobs'],['POST','/v1/conversations'],
      ['POST','/v1/conversations/thread-id/messages'],['POST','/v1/conversations/thread-id/extend'],
      ['POST','/v1/admin/agents/sender/test'],['POST','/v1/admin/schedules'],['POST','/v1/admin/tick'],
      ['PUT','/v1/agents/sender/activation']];
    for(const [method,path] of routes) {
      const response=await f.ownerRequest(path,{method,...method==='POST'?{body:{}}:{}});
      assert.equal(response.status,429,`${method} ${path}: ${response.text}`);
    }
    assert.deepEqual(f.counters(),[]);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM resource_lane_budgets').get().n,0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n,0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM schedules').get().n,0);
    status(await f.ownerRequest('/v1/admin/workspace',{method:'PATCH',body:{paused:true}}),200);
    assert.deepEqual(f.counters(),[]);
    assert.ok(f.sqlite.prepare("SELECT day_used FROM resource_lane_budgets WHERE lane='owner'").all().every(row=>row.day_used===10));
  });

  await check('owner recovery survives exhausted work budgets but cannot dispatch new work or bypass its own cap', async () => {
    const f=fixture(),sender=f.agent('sender'),receiver=f.agent('receiver');
    const sent=await f.send(sender,receiver),held=await f.claim(receiver,sent.request.id);
    for(const scope of ['GLOBAL','WORKSPACE'])for(const period of ['DAILY','MONTHLY'])f.env[`RESOURCE_${scope}_${period}_OPERATIONS`]='0';
    status(await f.request('/v1/me',{token:sender.token}),429);
    status(await f.request('/v1/admin/workspace',{token:sender.token}),429);
    status(await f.ownerRequest('/v1/admin/overview'),200);
    status(await f.ownerRequest('/v1/admin/export'),200);
    for(const paused of [true,false])status(await f.ownerRequest('/v1/admin/workspace',{method:'PATCH',body:{paused}}),200);
    status(await f.ownerRequest('/v1/jobs',{method:'POST',body:{to:receiver.id,type:'task',title:'No bypass',goal:'Must not dispatch'}}),429);
    status(await f.ownerRequest(`/v1/jobs/${sent.request.id}/cancel`,{method:'POST',body:{}}),200);
    status(await f.ownerRequest('/v1/admin/agents',{method:'POST',body:{id:receiver.id,name:'Receiver',can_work:true,can_request:true,rotate_token:true}}),200);
    status(await f.ownerRequest(`/v1/admin/agents/${receiver.id}`,{method:'DELETE'}),200);
    assert.equal(f.sqlite.prepare('SELECT id FROM agents WHERE id=?').get(receiver.id),undefined);
    assert.ok(f.sqlite.prepare('SELECT revoked_at FROM claims WHERE token_hash=?').get(hash(held.claim_id)).revoked_at);
    f.env.RESOURCE_OWNER_WORKSPACE_DAILY_OPERATIONS='0';
    assert.equal(status(await f.ownerRequest('/v1/admin/workspace'),429).error.code,'owner_workspace_budget_exhausted');
  });

  await check('MCP recovery handshakes and notifications are charged within the bounded reserve', async () => {
    const f=fixture(),sender=f.agent('sender'),grant=f.oauth(sender);
    f.env.RESOURCE_ESSENTIAL_RESERVE_PERCENT='10';
    for(const scope of ['GLOBAL','WORKSPACE'])for(const period of ['DAILY','MONTHLY'])f.env[`RESOURCE_${scope}_${period}_OPERATIONS`]='100';
    status(await f.request('/v1/me',{token:sender.token}),200);
    f.sqlite.prepare('UPDATE resource_operation_budgets SET day_used=90,month_used=90').run();
    for(const method of ['initialize','tools/list','ping']) {
      const response=await f.request('/mcp',{method:'POST',token:grant.token,body:{jsonrpc:'2.0',id:1,method,params:method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Fixture',version:'1'}}:{}}});
      assert.equal(status(response,200).error,undefined,response.text);
    }
    const notification=await f.request('/mcp',{method:'POST',token:grant.token,body:{jsonrpc:'2.0',method:'notifications/initialized'}});
    assert.equal(notification.status,202);
    assert.ok(f.counters().every(row=>row.day_used===94));
  });

  await check('MCP send-only transition receipts do not echo stored titles', async () => {
    for(const action of ['cancel_job','answer_question','send_back']) {
      const f=fixture(),sender=f.agent('sender'),receiver=f.agent('receiver'),grant=f.oauth(sender,['relay:send']);
      const sent=await f.send(sender,receiver,'Fixture request',{title:'PRIVATE_STORED_TITLE'});
      if(action!=='cancel_job') {
        const held=await f.claim(receiver,sent.request.id);
        status(await f.reply(receiver,sent.request.id,held.claim_id,'Fixture response',action==='answer_question'?'needs_input':'completed'),200);
      }
      const response=await f.rpc(grant.token,action,{job_id:sent.request.id,...(action==='answer_question'?{answer:'Use the brief.'}:action==='send_back'?{feedback:'Revise it.'}:{})});
      assert.equal(status(response,200).result.isError,false,response.text);
      assert.ok(!response.text.includes('PRIVATE_STORED_TITLE'));assert.ok(response.text.includes(sent.request.id));
    }
  });

  await check('deep result data is rejected before retry counters or history can accept it without a schema', async () => {
    const f=fixture(),sender=f.agent('sender'),receiver=f.agent('receiver');
    const sent=await f.send(sender,receiver),held=await f.claim(receiver,sent.request.id);
    const raw='{"status":"completed","summary":"Nested data","data":'+'['.repeat(3000)+'0'+']'.repeat(3000)+'}';
    for(let i=0;i<5;i++)assert.equal(status(await f.request('/v1/submit',{method:'POST',token:receiver.token,raw,headers:{'content-type':'application/json','x-claim-token':held.claim_id}}),400).error.code,'invalid_result_data');
    const row=f.sqlite.prepare('SELECT status,result,invalid_submits FROM jobs WHERE id=?').get(sent.request.id);
    assert.equal(row.status,'claimed');assert.equal(row.result,null);assert.equal(row.invalid_submits,0);
    status(await f.reply(receiver,sent.request.id,held.claim_id,'A normal answer still works.'),200);
  });

  console.log(`\n${checks} security HTTP/MCP boundary checks passed; ${failures} failed.`);
  if (failures) process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  for (const database of databases) database.close();
  await rm(temporary, { recursive: true, force: true });
}
