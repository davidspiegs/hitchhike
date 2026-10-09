/** Migrated SQLite + the real Worker HTTP boundary. Synthetic credentials only;
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
  await build({ entryPoints: [join(root, 'src/index.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const { default: worker } = await import(pathToFileURL(bundle).href);
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

  for (const hosted of [false, true]) {
    const mode = hosted ? 'hosted' : 'self-host';
    await check(`${mode}: beta is owner-controlled, per workspace, and preserves legacy access`, async () => {
      const f = await fixture(hosted), dot = f.agent('dot'), claude = f.agent('claude');
      assert.equal(status(await f.ownerRequest('/v1/workspace/release'), 200).enabled, false);
      assert.equal(status(await f.request('/v1/conversations', { token: dot.token }), 409).error.code, 'beta_disabled');
      status(await f.request('/v1/workspace/release', { method: 'PUT', token: dot.token, body: { enabled: true } }), 403);
      assert.equal((await f.enable()).enabled, true);
      assert.deepEqual(status(await f.request('/v1/conversations', { token: dot.token }), 200).conversations, []);
      const sent = await f.send(dot, claude);
      assert.ok(sent.request.id); assert.equal(sent.message.from, dot.id);
      await f.ownerRequest('/v1/workspace/release', { method: 'PUT', body: { enabled: false } });
      assert.equal(status(await f.request(`/v1/conversations/${sent.conversation.id}`, { token: dot.token }), 409).error.code, 'beta_disabled');
      assert.equal(status(await f.request(`/v1/jobs/${sent.request.id}`, { token: dot.token }), 200).job.id, sent.request.id);
      if (hosted) {
        const foreign = await f.signIn('foreign@example.test');
        assert.equal(status(await f.request('/v1/workspace/release', foreign), 200).enabled, false);
        // Environment overrides must never enable all hosted workspaces.
        f.env.NEXT_RELEASE_BETA = 'true';
        assert.equal(status(await f.request('/v1/workspace/release', foreign), 200).enabled, false);
      }
    });

    await check(`${mode}: a directed exchange preserves clarification, revision, and independent delivery`, async () => {
      const f = await fixture(hosted), dot = f.agent('dot'), claude = f.agent('claude'), outsider = f.agent('outsider'); await f.enable();
      const sent = await f.send(dot, claude, 'Critique the onboarding plan.', { idempotency_key: 'initial' });
      const id = sent.request.id, cid = sent.conversation.id;
      assert.equal(sent.replay, false);
      const duplicate = status(await f.request('/v1/conversations', { method: 'POST', token: dot.token, body: { to: claude.id, message: 'Critique the onboarding plan.', idempotency_key: 'initial' } }), 200);
      assert.equal(duplicate.request.id, id); assert.equal(duplicate.replay, true);
      status(await f.request('/v1/conversations', { method: 'POST', token: dot.token, body: { to: claude.id, message: 'A different request.', idempotency_key: 'initial' } }), 409);
      const pending = status(await f.request('/v1/requests/pending', { token: claude.token }), 200).requests;
      assert.deepEqual(pending.map(request => request.id), [id]);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM claims').get().n, 0);
      status(await f.request(`/v1/requests/${id}/claim`, { method: 'POST', token: outsider.token, body: { consumer_id: 'wrong' } }), 404);
      const first = await f.claim(claude, id); assert.equal(first.request.id, id); assert.ok(first.claim_id);
      const collision = await f.claim(claude, id, 'interactive-1'); assert.equal(collision.request, null);
      const legacy = status(await f.request('/v1/work/next?format=json', { method: 'POST', token: claude.token }), 200);
      assert.equal(legacy.job, null, 'legacy consumer must not receive the scheduled consumer claim');
      const question = status(await f.reply(claude, id, first.claim_id, 'Should mobile setup work without a desktop?', 'needs_input'), 200);
      assert.equal(question.outcome, 'QUESTION_SENT');
      status(await f.request(`/v1/jobs/${id}/reply`, { method: 'POST', token: dot.token, body: { message: 'Yes, except explicitly desktop-only provider steps.' } }), 200);
      const second = await f.claim(claude, id); assert.equal(second.request.id, id);
      assert.match(JSON.stringify(second.request.conversation_context), /desktop-only/);
      status(await f.reply(claude, id, second.claim_id, 'First critique: keep setup resumable.'), 200);
      status(await f.request(`/v1/jobs/${id}/reject`, { method: 'POST', token: dot.token, body: { message: 'Revise point two to explain waiting.' } }), 200);
      const beforeRevision = status(await f.request(`/v1/conversations/${cid}`, { token: dot.token }), 200);
      assert.ok(beforeRevision.messages.some(message => message.text.includes('First critique')));
      assert.ok(beforeRevision.messages.some(message => message.text.includes('Revise point two')));
      const third = await f.claim(claude, id); assert.equal(third.request.id, id);
      status(await f.reply(claude, id, second.claim_id, 'Stale answer must not replace history.'), 409);
      status(await f.reply(claude, id, third.claim_id, 'Revised critique: show verified pickup intervals.'), 200);
      const interactive = status(await f.request('/v1/conversations/inbox?consumer_id=interactive', { token: dot.token }), 200);
      const page = interactive.conversations.find(value => value.conversation.id === cid); assert.ok(page);
      assert.ok(page.messages.some(message => message.text.includes('Revised critique')));
      status(await f.request(`/v1/conversations/${cid}/acknowledge`, { method: 'POST', token: dot.token, body: { consumer_id: 'interactive', cursor: page.next_cursor } }), 200);
      assert.equal(status(await f.request('/v1/conversations/inbox?consumer_id=interactive', { token: dot.token }), 200).conversations.length, 0);
      const scheduled = status(await f.request('/v1/conversations/inbox?consumer_id=scheduled', { token: dot.token }), 200);
      assert.equal(scheduled.conversations.length, 1, 'interactive acknowledgment cannot hide delivery from a recurring consumer');
      const history = status(await f.request(`/v1/conversations/${cid}?limit=2`, { token: dot.token }), 200);
      assert.equal(history.messages.length, 2); assert.equal(history.has_more, true);
      const next = status(await f.request(`/v1/conversations/${cid}?after=${history.next_cursor}&limit=100`, { token: dot.token }), 200);
      const all = [...history.messages, ...next.messages];
      assert.equal(new Set(all.map(message => message.id)).size, all.length);
      assert.ok(all.some(message => message.text.includes('First critique'))); assert.ok(all.some(message => message.text.includes('Revised critique')));
      assert.equal(history.conversation.retention_days, 30); assert.ok(history.conversation.expires_at);
      const config = status(await f.request('/v1/configuration', { token: dot.token }), 200);
      assert.equal(config.readiness.collaboration.verified, true); assert.equal(config.readiness.background.verified, false);
      assert.equal(config.readiness.peer_collaboration.verified, true);
      const finished = status(await f.ownerRequest(`/v1/agents/${dot.id}/onboarding`, { method: 'PATCH', body: { provider: 'dot', surface: 'dots', step: 'done' } }), 200);
      assert.equal(finished.onboarding.step, 'done');
      status(await f.request(`/v1/conversations/${cid}`, { token: outsider.token }), 404);
      status(await f.request(`/v1/conversations/${cid}/acknowledge`, { method: 'POST', token: outsider.token, body: { consumer_id: 'scheduled', cursor: page.next_cursor } }), 404);
      assert.ok(f.sqlite.prepare('SELECT retrieved_at FROM jobs WHERE id=?').get(id).retrieved_at);
    });

    await check(`${mode}: owner settings enforce categories and peers without trusting setup completion`, async () => {
      const f = await fixture(hosted), dot = f.agent('dot'), claude = f.agent('claude'), excluded = f.agent('excluded'); await f.enable();
      const configPath = `/v1/agents/${dot.id}/collaboration`;
      const initial = status(await f.request('/v1/configuration', { token: dot.token }), 200);
      assert.equal(initial.agent_id, dot.id); assert.equal(initial.version, 0);
      status(await f.request(configPath, { method: 'PUT', token: dot.token, body: { purpose: 'Agent cannot grant itself permissions.' } }), 403);
      status(await f.request(`/v1/agents/${claude.id}/collaboration`, { token: dot.token }), 403);
      const edited = status(await f.ownerRequest(configPath, { method: 'PUT', body: { expected_version: 0, permitted_collaborators: [claude.id], allowed_request_categories: ['review'], purpose: 'Ask for second opinions.', sharing: { approved_sources: ['https://example.test/approved'] } } }), 200);
      assert.equal(edited.version, 1); assert.deepEqual(edited.roster.map(peer => peer.id), [claude.id]);
      status(await f.ownerRequest(configPath, { method: 'PUT', body: { expected_version: 0, purpose: 'Overwrite another edit.' } }), 409);
      status(await f.request('/v1/conversations', { method: 'POST', token: dot.token, body: { to: excluded.id, type: 'review', message: 'Denied peer' } }), 403);
      status(await f.request('/v1/conversations', { method: 'POST', token: dot.token, body: { to: claude.id, type: 'task', message: 'Denied category' } }), 403);
      const allowed = await f.send(dot, claude, 'Review permitted context.', { type: 'review' }); assert.ok(allowed.request.id);
      const complete = status(await f.ownerRequest(`/v1/agents/${dot.id}/onboarding`, { method: 'PATCH', body: { provider: 'dot', surface: 'dots', step: 'done' } }), 200);
      assert.equal(complete.onboarding.step, 'done');
      assert.equal(complete.readiness.peer_collaboration.verified, false);
      assert.equal(complete.readiness.background.verified, false);
      const setup = status(await f.ownerRequest(`/v1/agents/${dot.id}/onboarding`, { method: 'PATCH', body: { provider: 'dot', surface: 'dots', step: 'exchange' } }), 200);
      assert.equal(setup.onboarding.step, 'exchange'); assert.equal(setup.readiness.peer_collaboration.verified, false); assert.equal(setup.readiness.background.verified, false);
      status(await f.ownerRequest(`/v1/agents/${dot.id}/onboarding`, { method: 'PATCH', body: { step: 'done', background_verified: true } }), 400);
      const refreshed = status(await f.request('/v1/configuration', { token: dot.token }), 200);
      assert.equal(refreshed.version, 1); assert.equal(refreshed.settings.purpose, 'Ask for second opinions.');
      assert.deepEqual(refreshed.settings.instructions, { profile: 'judgment', custom_prompt: null });
      assert.match(refreshed.runtime_instructions.working_preference, /If helpful, you may/);
      assert.equal(refreshed.runtime_instructions.protocol, 'conversations');
      const instructions = { profile: 'offload', custom_prompt: 'Delegate permitted research.\nKeep the final decision with me.' };
      status(await f.ownerRequest(configPath, { method: 'PUT', body: { expected_version: 1, instructions } }), 200);
      const saved = status(await f.request('/v1/configuration', { token: dot.token }), 200);
      assert.deepEqual(saved.settings.instructions, instructions);
      assert.equal(saved.runtime_instructions.working_preference, null);
      assert.match(saved.runtime_instructions.text, /settings.instructions.custom_prompt/);
      assert.equal(saved.settings.initiative, false);
      assert.deepEqual(saved.settings.permitted_collaborators, [claude.id]);
      status(await f.ownerRequest(configPath, { method: 'PUT', body: { expected_version: 1, instructions: { custom_prompt: 'Stale draft' } } }), 409);
      status(await f.request(configPath, { method: 'PUT', token: dot.token, body: { instructions: { custom_prompt: 'Agent cannot change owner preferences' } } }), 403);
      const peerView = status(await f.request('/v1/configuration', { token: claude.token }), 200);
      assert.ok(!JSON.stringify(peerView.roster).includes(instructions.custom_prompt));
      // Revoking the recipient's permission after queuing also blocks pickup.
      status(await f.ownerRequest(`/v1/agents/${claude.id}/collaboration`, { method: 'PUT', body: { allowed_work_categories: [] } }), 200);
      assert.deepEqual(status(await f.request('/v1/requests/pending', { token: claude.token }), 200).requests, []);
      assert.equal((await f.claim(claude, allowed.request.id)).request, null);
    });

    await check(`${mode}: saved working preference reaches the provider's recurring instructions`, async () => {
      const f = await fixture(hosted); await f.enable();
      const created = status(await f.ownerRequest('/v1/admin/agents', { method: 'POST', body: { id: 'guide-claude', name: 'Guide Claude', platform: 'claude', can_request: true, can_work: true, work_types: ['task'] } }), 201);
      const id = created.agent.id;
      const setupPath=`/v1/admin/agents/${id}/setup?surface=chat`;
      const fresh=status(await f.ownerRequest(setupPath),200).guide;
      assert.deepEqual(fresh.backgroundSelection,{enabled:true,intervalMinutes:60});
      assert.match(fresh.collaborationPrompt,/Create an hourly/);
      const before=f.sqlite.prepare('SELECT * FROM agent_collaboration WHERE agent_id=?').get(id);
      const preview=status(await f.ownerRequest(setupPath+'&background_enabled=true&background_interval=10'),200).guide;
      assert.deepEqual(preview.backgroundSelection,{enabled:true,intervalMinutes:10});
      assert.match(preview.collaborationPrompt,/every 10 minutes/);
      assert.doesNotMatch(status(await f.ownerRequest(setupPath+'&background_enabled=false'),200).guide.collaborationPrompt,/Create an hourly/);
      for(const query of ['background_enabled=maybe','background_enabled=true&background_interval=1','background_interval=10','background_enabled=true&background_enabled=false','background_enabled=true&background_interval=10081']) {
        status(await f.ownerRequest(setupPath+'&'+query),400);
      }
      assert.deepEqual(f.sqlite.prepare('SELECT * FROM agent_collaboration WHERE agent_id=?').get(id),before,'preview cannot save a schedule preference');
      status(await f.ownerRequest(`/v1/agents/${id}/collaboration`, { method: 'PUT', body: { expected_version: 0, instructions: { profile: 'second_opinion' } } }), 200);
      assert.deepEqual(status(await f.ownerRequest(setupPath),200).guide.backgroundSelection,{enabled:false,intervalMinutes:null},'preserve an existing manual configuration');
      status(await f.ownerRequest(`/v1/agents/${id}/collaboration`, { method: 'PUT', body: { expected_version: 1, setup_background:{enabled:true,interval_minutes:60} } }), 200);
      for (const method of ['GET', 'POST']) {
        const response = status(await f.ownerRequest(`/v1/admin/agents/${id}/setup?surface=chat`, { method }), 200);
        assert.match(response.guide.backgroundGuide.runPrompt, /Load get_collaboration_config/);
        assert.match(response.guide.backgroundGuide.runPrompt, /current saved working preference/);
        assert.doesNotMatch(response.guide.backgroundGuide.runPrompt, /Working preference:/);
        assert.equal(response.guide.backgroundGuide.intervalLabel, 'Hourly requested');
        assert.equal(response.guide.routinePrompt, undefined);
      }
      const token = hosted ? f.oauth({ id, workspace: f.owner.workspace }, ['relay:read']) : created.token;
      const config = status(await f.request('/v1/configuration', { token }), 200);
      assert.equal(config.settings.instructions.profile, 'second_opinion');
      assert.match(config.runtime_instructions.working_preference, /independent research/);
    });

    await check(`${mode}: stop invalidates claims and scope checks precede relay mutation`, async () => {
      const f = await fixture(hosted), dot = f.agent('dot'), claude = f.agent('claude'), observer = f.agent('observer', { can_request: false, can_work: false }); await f.enable();
      const sent = await f.send(dot, claude), cid = sent.conversation.id, id = sent.request.id;
      status(await f.request('/v1/conversations', { method: 'POST', token: observer.token, body: { to: claude.id, message: 'Must not dispatch' } }), 403);
      status(await f.request(`/v1/requests/${id}/claim`, { method: 'POST', token: observer.token, body: { consumer_id: 'observer' } }), 403);
      const held = await f.claim(claude, id); assert.ok(held.claim_id);
      status(await f.request(`/v1/conversations/${cid}/stop`, { method: 'POST', token: dot.token, body: {} }), 403);
      status(await f.ownerRequest(`/v1/conversations/${cid}/stop`, { method: 'POST', body: {} }), 200);
      const stopped = status(await f.request(`/v1/conversations/${cid}`, { token: dot.token }), 200);
      assert.ok(stopped.conversation.stopped_at); assert.equal(stopped.requests[0].status, 'canceled');
      const late = await f.reply(claude, id, held.claim_id, 'Late provider output');
      assert.ok([200, 404, 409].includes(late.status)); // CLOSED/UNKNOWN/SENT_BACK all reject persistence.
      assert.notEqual(late.data.outcome, 'ACCEPTED');
      assert.equal(f.sqlite.prepare('SELECT result FROM jobs WHERE id=?').get(id).result, null);
      status(await f.request(`/v1/conversations/${cid}/messages`, { method: 'POST', token: dot.token, body: { to: claude.id, message: 'No more dispatches' } }), 409);
      const history = status(await f.request(`/v1/conversations/${cid}`, { token: dot.token }), 200);
      assert.ok(!history.messages.some(message => message.text.includes('Late provider output')));
      if (hosted) {
        const readOnly = f.oauth(dot, ['relay:read']);
        status(await f.request('/v1/configuration', { token: readOnly }), 200);
        status(await f.request('/v1/conversations', { method: 'POST', token: readOnly, body: { to: claude.id, message: 'OAuth cannot bypass scope' } }), 403);
        const sendOnly = f.oauth(dot, ['relay:send']);
        status(await f.request(`/v1/conversations/${cid}`, { token: sendOnly }), 403);
        status(await f.request('/v1/configuration', { token: sendOnly }), 403);
      }
    });
  }

  await check('shared context is owner-controlled, versioned, retained in history, and delivered at pickup', async () => {
    const f = await fixture(true), dot = f.agent('dot'), claude = f.agent('claude'); await f.enable();
    const sent = await f.send(dot, claude, 'Review the supplied plan.'), cid = sent.conversation.id;
    const path = `/v1/conversations/${cid}/context`;
    const original = 'Use only this supplied brief and https://example.test/approved.';
    const revised = 'Use the supplied brief. The approved source is https://example.test/revised.';
    assert.equal(sent.conversation.context_version, 0); assert.equal(sent.conversation.pinned_context, '');
    status(await f.request(path, { method: 'PATCH', token: dot.token, body: { pinned_context: original, expected_version: 0 } }), 403);
    const saved = status(await f.ownerRequest(path, { method: 'PATCH', body: { pinned_context: original, expected_version: 0 } }), 200);
    assert.equal(saved.conversation.pinned_context, original); assert.equal(saved.conversation.context_version, 1);
    assert.equal(saved.message.kind, 'context'); assert.equal(saved.message.from, 'owner'); assert.equal(saved.message.text, original);
    const updated = status(await f.ownerRequest(path, { method: 'PATCH', body: { pinned_context: revised, expected_version: 1 } }), 200);
    assert.equal(updated.conversation.context_version, 2); assert.equal(updated.message.context.previous_text, original);
    const stale = status(await f.ownerRequest(path, { method: 'PATCH', body: { pinned_context: 'Accidental stale replacement.', expected_version: 1 } }), 409);
    assert.equal(stale.error.code, 'context_changed');
    const noOp = status(await f.ownerRequest(path, { method: 'PATCH', body: { pinned_context: revised, expected_version: 2 } }), 200);
    assert.equal(noOp.conversation.context_version, 2); assert.equal(noOp.message, null);
    const foreign = await f.signIn('context-outsider@example.test');
    status(await f.request('/v1/workspace/release', { ...foreign, method: 'PUT', body: { enabled: true } }), 200);
    status(await f.request(path, { ...foreign, method: 'PATCH', body: { pinned_context: 'Foreign replacement.', expected_version: 2 } }), 404);
    const history = status(await f.request(`/v1/conversations/${cid}`, { token: claude.token }), 200);
    assert.equal(history.conversation.context_version, 2); assert.equal(history.conversation.pinned_context, revised);
    assert.deepEqual(history.messages.filter(message => message.kind === 'context').map(message => message.text), [original, revised]);
    assert.ok(history.messages.some(message => message.text === 'Review the supplied plan.'));
    const held = await f.claim(claude, sent.request.id);
    assert.equal(held.request.conversation_context.pinned_context, revised);
    assert.equal(held.request.conversation_context.context_version, 2);
  });

  await check('request replies bind the claim to both the URL and authenticated connection', async () => {
    const f = await fixture(), dot = f.agent('dot'), claude = f.agent('claude'), stranger = f.agent('stranger'); await f.enable();
    f.sqlite.prepare('UPDATE agents SET max_leases=2 WHERE id=?').run(claude.id);
    const first = await f.send(dot, claude, 'First request.'), second = await f.send(dot, claude, 'Second request.');
    const a = await f.claim(claude, first.request.id, 'run-a'), b = await f.claim(claude, second.request.id, 'run-b');
    assert.ok(a.claim_id); assert.ok(b.claim_id);
    status(await f.reply(claude, first.request.id, b.claim_id, 'Claim for a different request.'), 404);
    status(await f.reply(stranger, first.request.id, a.claim_id, 'Claim stolen by a different connection.'), 404);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM jobs WHERE result IS NOT NULL').get().n, 0);
    assert.equal(status(await f.reply(claude, first.request.id, a.claim_id, 'Right request and owner.'), 200).outcome, 'ACCEPTED');
    assert.equal(status(await f.reply(claude, first.request.id, a.claim_id, 'Repeated answer should not append.'), 200).outcome, 'ALREADY_DONE');
    const history = status(await f.request(`/v1/conversations/${first.conversation.id}`, { token: dot.token }), 200);
    assert.equal(history.messages.filter(message => message.kind === 'answer').length, 1);
  });

  await check('hosted owner changes require the existing session CSRF protection', async () => {
    const f = await fixture(true); f.agent('dot');
    for (const options of [{ csrf: undefined }, { csrf: 'forged' }, { origin: null }, { origin: 'https://foreign.example.test' }]) {
      const response = await f.ownerRequest('/v1/workspace/release', { method: 'PUT', body: { enabled: true }, ...options });
      status(response, 403);
      assert.equal(status(await f.ownerRequest('/v1/workspace/release'), 200).enabled, false);
    }
    status(await f.request('/v1/configuration'), 401);
    await f.enable();
    assert.equal(status(await f.ownerRequest('/v1/workspace/release'), 200).enabled, true);
  });

  await check('hosted identities cannot enumerate, read, claim, configure, or acknowledge another workspace', async () => {
    const f = await fixture(true), dot = f.agent('dot'), claude = f.agent('claude'); await f.enable();
    const sent = await f.send(dot, claude), cid = sent.conversation.id, id = sent.request.id;
    const foreignOwner = await f.signIn('outsider@example.test'), outsider = f.agent('foreign-agent', { workspace: foreignOwner.workspace });
    status(await f.request('/v1/workspace/release', { ...foreignOwner, method: 'PUT', body: { enabled: true } }), 200);
    assert.deepEqual(status(await f.request('/v1/conversations', { token: outsider.token }), 200).conversations, []);
    assert.deepEqual(status(await f.request('/v1/requests/pending', { token: outsider.token }), 200).requests, []);
    for (const credentials of [foreignOwner, { token: outsider.token }]) {
      status(await f.request(`/v1/conversations/${cid}`, credentials), 404);
      status(await f.request(`/v1/agents/${claude.id}/activation`, credentials), credentials.token ? 403 : 404);
    }
    status(await f.request(`/v1/requests/${id}/claim`, { method: 'POST', token: outsider.token, body: { consumer_id: 'foreign' } }), 404);
    status(await f.request(`/v1/conversations/${cid}/acknowledge`, { method: 'POST', token: outsider.token, body: { consumer_id: 'foreign', cursor: sent.message.id } }), 404);
    status(await f.request(`/v1/agents/${claude.id}/collaboration`, { ...foreignOwner, method: 'PUT', body: { purpose: 'cross-workspace edit' } }), 404);
    status(await f.request(`/v1/conversations/${cid}/stop`, { ...foreignOwner, method: 'POST', body: {} }), 404);
    assert.equal(f.sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(id).status, 'queued');
    // A forged body never controls attribution or tenant selection.
    status(await f.request('/v1/conversations', { method: 'POST', token: outsider.token, body: { workspace_id: f.owner.workspace, from: dot.id, to: claude.id, message: 'Forged' } }), 400);
  });

  await check('health reports the stamped release and the Worker version with exactly four keys', async () => {
    const f = await fixture(false);
    f.env.HITCHHIKE_RELEASE = 'abc123def456'; f.env.CF_VERSION_METADATA = { id: 'v-1' };
    const stamped = await f.request('/healthz');
    assert.deepEqual(status(stamped, 200), { ok: true, protocol: '0.1', release: 'abc123def456', version: 'v-1' });
    assert.deepEqual(Object.keys(stamped.data).sort(), ['ok', 'protocol', 'release', 'version']);
  });

  await check('health withholds malformed releases and reports null without the version binding', async () => {
    const f = await fixture(true);
    f.env.HITCHHIKE_RELEASE = ' bad value!'; delete f.env.CF_VERSION_METADATA;
    assert.deepEqual(status(await f.request('/healthz'), 200), { ok: true, protocol: '0.1', release: null, version: null });
    for (const [value, expected] of [[' v1.2.3 ', 'v1.2.3'], ['', null], ['a'.repeat(65), null], ['a/b', null], [undefined, null]]) {
      f.env.HITCHHIKE_RELEASE = value;
      assert.equal(status(await f.request('/healthz'), 200).release, expected, JSON.stringify(value));
    }
  });

  console.log(`\n${count} next-release HTTP integration checks passed.`);
} finally {
  globalThis.fetch = originalFetch;
  for (const database of databases) database.close();
  await rm(temporary, { recursive: true, force: true });
}
