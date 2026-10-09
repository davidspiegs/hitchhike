/** Real migrated SQLite tests for history, leases, receipts, quotas, and retention. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'hitchhike-conversations-'));
const sqlite = new DatabaseSync(':memory:');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Conversation tests must not contact external services.'); };
const now = Date.now(), DAY = 86400000;
let checks = 0;
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
    const result = statements.map(s => { const q = sqlite.prepare(s.sql); return q.columns().length ? { results: q.all(...s.values), meta: sqlite.prepare('SELECT changes() changes').get(), success: true } : { results: [], meta: q.run(...s.values), success: true }; });
    sqlite.exec('COMMIT'); return result;
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
} };
const env = { DB, HOSTED: 'true', MIN_LEASE_SECONDS: '1' };
const owner = { owner: true, agent: null };
const agent = id => sqlite.prepare('SELECT * FROM agents WHERE id=?').get(id);
const actor = id => ({ owner: false, agent: agent(id) });
const count = table => sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
const check = async (label, fn) => { await fn(); console.log(`ok ${++checks} - ${label}`); };
function reset() {
  for (const table of ['wake_deliveries', 'claims', 'events', 'jobs', 'conversation_messages', 'conversation_receipts', 'conversations', 'conversation_chains', 'agent_collaboration', 'agent_onboarding', 'collaboration_background_runs', 'agents']) sqlite.exec(`DELETE FROM ${table}`);
  sqlite.exec("UPDATE workspaces SET paused=0,daily_job_limit=1000,monthly_job_limit=10000,max_open_jobs=1000,storage_limit_bytes=100000000,retention_days=30 WHERE id='default'");
  for (const id of ['cleo', 'claude', 'grok', 'stranger']) sqlite.prepare(`INSERT INTO agents(id,handle,name,token_hash,can_work,can_request,work_types,created_at) VALUES(?,?,?,?,1,1,'["task"]',?)`).run(id, id, id, `synthetic-${id}`, now);
}
try {
  const migrations = (await readdir(join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort();
  for (const file of migrations.filter(f => f < '0011')) sqlite.exec(await readFile(join(root, 'migrations', file), 'utf8'));
  // Backfill evidence exists BEFORE the additive migration.
  sqlite.prepare(`INSERT INTO jobs(id,v,type,from_agent,to_agent,title,spec,status,thread,lease_seconds,attempts,result,result_by,created_at,updated_at,completed_at) VALUES('legacy','1','task','cleo','claude','Old request','{"goal":"Old goal"}','completed','[{"at":"2026-01-01T00:00:00.000Z","from":"cleo","kind":"feedback","text":"Old feedback"}]',300,1,'{"summary":"Surviving answer","body":"Full old answer"}','claude',?,?,?)`).run(now - DAY, now, now);
  sqlite.prepare(`INSERT INTO jobs(id,v,type,from_agent,to_agent,title,spec,status,thread,lease_seconds,created_at,updated_at) VALUES('legacy-unattributed','1','task','cleo','claude','Old partial history','{"goal":"Older task"}','completed','[{"kind":"reply","text":"Unattributed old note"},{"anything":"unrecognized"},"raw historical entry"]',300,?,?)`).run(now - DAY, now);
  sqlite.prepare("UPDATE jobs SET parent_id='legacy' WHERE id='legacy-unattributed'").run();
  for (const file of migrations.filter(f => f >= '0011')) sqlite.exec(await readFile(join(root, 'migrations', file), 'utf8'));
  await build({ stdin: { contents: "export * from './src/conversations'; export * from './src/store'; export { updateCollaborationConfiguration } from './src/collaboration'; export { renderJobForWorker } from './src/render'; export { JOB_TYPES } from './src/jobtypes';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: join(temp, 'api.mjs'), logLevel: 'silent' });
  const api = await import(pathToFileURL(join(temp, 'api.mjs')).href);
  const send = (settings = {}, from = 'cleo', at = now) => api.sendMessage(env, actor(from), { to: 'claude', message: 'Please critique this plan.', ...settings }, at);
  const claim = (id, execution = 'run-1', at = now, who = 'claude') => api.claimRequest(env, agent(who), id, execution, at);
  const complete = (token, at = now, summary = 'A thoughtful critique.') => api.submitResult(env, token, { summary, body: 'The complete answer with important detail.' }, [], at);

  await check('additive migration backfills surviving legacy content without inventing overwritten answers', async () => {
    const history = await api.readConversation(env, owner, 'conv_legacy');
    assert.deepEqual(history.messages.map(m => m.kind), ['request', 'revision', 'answer']);
    assert.equal(history.messages[2].result.body, 'Full old answer');
  });
  await check('legacy history missing metadata is preserved and explicitly unattributed', async () => {
    const history = await api.readConversation(env, owner, 'conv_legacy-unattributed');
    assert.equal(history.messages[1].from, 'legacy-unattributed');
    assert.equal(history.messages[1].text, 'Unattributed old note');
    assert.equal(history.messages[2].kind, 'note');
    assert.match(history.messages[2].text, /unrecognized/);
    assert.equal(history.messages[3].text, 'raw historical entry');
  });
  await check('migration retains legacy ancestry and original chain allowances', async () => {
    const child = await api.getJobRow(env, 'legacy-unattributed');
    assert.equal(child.chain_root_id, 'legacy'); assert.equal(child.delegation_depth, 1);
    const chain = sqlite.prepare("SELECT * FROM conversation_chains WHERE root_id='legacy'").get();
    assert.equal(chain.max_requests, 26); assert.equal(chain.max_depth, 5); assert.equal(chain.requests_used, 2);
    assert.equal((await api.readConversation(env, owner, 'conv_legacy-unattributed')).conversation.chain_root_id, 'legacy');
  });
  await check('legacy jobs retain five follow-up levels and an atomic twenty-five-descendant allowance', async () => {
    reset();
    const legacy = async parent => (await api.createJob(env, 'cleo', agent('cleo'), { type: 'task', to: 'claude', title: 'Legacy task', goal: 'Keep the existing contract.', ...(parent ? { parent_id: parent } : {}) }, undefined, now)).row;
    let parent = await legacy();
    for (let level = 1; level <= 5; level++) { parent = await legacy(parent.id); assert.equal(parent.delegation_depth, level); assert.equal(parent.requires_consumer, 0); }
    await assert.rejects(legacy(parent.id), e => e.status === 429 && e.code === 'task_depth');
    const branch = await legacy();
    for (let index = 0; index < 24; index++) await legacy(branch.id);
    const final = await Promise.allSettled([legacy(branch.id), legacy(branch.id)]);
    assert.equal(final.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(final.find(r => r.status === 'rejected').reason.status, 429);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM jobs WHERE parent_id=?').get(branch.id).n, 25);
  });
  await check('legacy tools cannot bypass strict conversation depth, chain budget, or execution ownership', async () => {
    reset(); const strict = await send();
    const legacyChild = async parent => (await api.createJob(env, 'cleo', agent('cleo'), { type: 'task', to: 'claude', title: 'Mixed client', goal: 'Preserve strict ancestry.', parent_id: parent }, undefined, now)).row;
    const first = await legacyChild(strict.request.id); const second = await legacyChild(first.id);
    assert.equal(first.requires_consumer, 1); assert.equal(second.requires_consumer, 1);
    await assert.rejects(legacyChild(second.id), e => e.status === 409 && e.code === 'conversation_limit');
    for (let i = 0; i < 6; i++) await legacyChild(strict.request.id);
    const final = await Promise.allSettled([legacyChild(strict.request.id), legacyChild(strict.request.id)]);
    assert.equal(final.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(final.find(r => r.status === 'rejected').reason.code, 'conversation_limit');
    assert.equal((await api.claimNext(env, agent('claude'), now)).job, null);
  });
  await check('overview exposes the actual latest request and its current status even at one timestamp', async () => {
    reset(); const first = await send(); const second = await send({ conversation_id: first.conversation.id, message: 'The newest request.' });
    let overview = (await api.listConversations(env, actor('cleo')))[0];
    assert.equal(overview.latest_request.id, second.request.id); assert.equal(overview.latest_request.status, 'queued');
    const held = await claim(second.request.id);
    overview = (await api.listConversations(env, actor('cleo')))[0]; assert.equal(overview.latest_request.status, 'claimed');
    await api.submitResult(env, held.token, { status: 'failed', summary: 'Missing access.', error: 'No source access.' }, [], now);
    overview = (await api.listConversations(env, actor('cleo')))[0];
    assert.equal(overview.latest_request.status, 'failed'); assert.equal(overview.latest_request.error, 'No source access.');
    assert.equal(overview.latest_request.completed_at, new Date(now).toISOString());
    assert.equal((await api.readConversation(env, actor('cleo'), first.conversation.id)).requests[0].id, second.request.id);
  });
  await check('same-timestamp questions, answers, and revisions remain immutable and ordered', async () => {
    reset(); const sent = await send(); const first = await claim(sent.request.id);
    assert.equal((await api.submitResult(env, first.token, { status: 'needs_input', question: 'Which option?' }, [], now)).kind, 'question_sent');
    await api.transition(env, actor('cleo'), sent.request.id, 'reply', 'Use option A.', now);
    const resumed = await claim(sent.request.id, 'run-2'); await complete(resumed.token);
    await api.transition(env, actor('cleo'), sent.request.id, 'reject', 'Revise point two.', now);
    const revised = await claim(sent.request.id, 'run-3'); await complete(revised.token, now, 'Revised answer.');
    assert.equal((await complete(resumed.token)).kind, 'already_done');
    const history = await api.readConversation(env, actor('cleo'), sent.conversation.id);
    assert.deepEqual(history.messages.map(m => m.kind), ['request', 'question', 'reply', 'answer', 'revision', 'answer']);
    assert.equal(history.messages[3].result.summary, 'A thoughtful critique.');
    assert.equal(history.messages[5].result.summary, 'Revised answer.');
    assert.equal(new Set(history.messages.map(m => m.id)).size, 6);
  });
  await check('revisions expose full earlier answers to workers and explicitly identify oversized context', async () => {
    reset(); const sent = await send(); let held = await claim(sent.request.id);
    await api.submitResult(env, held.token, { summary: 'Original answer.', body: 'Detailed answer '.repeat(1000) }, [], now);
    await api.transition(env, actor('cleo'), sent.request.id, 'reject', 'Revise.', now);
    held = await claim(sent.request.id, 'revision');
    const context = api.jobView(held.job).conversation_context;
    assert.ok(context.truncated_message_ids.length);
    assert.match(api.renderJobForWorker(api.jobView(held.job), api.JOB_TYPES.task, { kind: 'mcp', claimId: held.token }), /Original answer/);
    const history = await api.readConversation(env, actor('cleo'), sent.conversation.id);
    assert.equal(history.messages.find(m => m.kind === 'answer').result.body.length, 16000);
  });
  await check('pending preview is read-only, target pickup stays targeted, and execution ownership prevents duplicate processing', async () => {
    reset(); const a = await send(); const b = await send({ message: 'A second request.' });
    const before = count('claims'); const preview = await api.previewRequests(env, agent('claude'));
    assert.equal(preview.length, 2); assert.equal(count('claims'), before);
    const [interactive, scheduled] = await Promise.all([claim(b.request.id, 'interactive-1'), claim(b.request.id, 'scheduled-1')]);
    assert.equal([interactive, scheduled].filter(r => r.job).length, 1);
    assert.equal((await api.getJobRow(env, a.request.id)).status, 'queued');
    assert.equal((await api.claimNext(env, agent('claude'), now)).job, null, 'Legacy polling cannot take or reissue a strict conversation request');
    const winner = interactive.job ? interactive : scheduled;
    const retry = await claim(b.request.id, interactive.job ? 'interactive-1' : 'scheduled-1');
    assert.equal(retry.resent, true); assert.equal(retry.job.attempts, 1);
    assert.equal((await complete(winner.token)).kind, 'accepted');
  });
  await check('inbox receipt cursors are independent, durable retrieval survives acknowledgment, and future cursors fail', async () => {
    reset(); const sent = await send(); const held = await claim(sent.request.id); await complete(held.token);
    const one = await api.checkConversationInbox(env, agent('cleo'), 'interactive');
    const two = await api.checkConversationInbox(env, agent('cleo'), 'scheduled');
    const cursor = one.conversations[0].next_cursor;
    assert.equal(two.conversations[0].next_cursor, cursor);
    await api.acknowledgeConversation(env, agent('cleo'), sent.conversation.id, 'interactive', cursor, now);
    assert.equal((await api.checkConversationInbox(env, agent('cleo'), 'interactive')).conversations.length, 0);
    assert.equal((await api.checkConversationInbox(env, agent('cleo'), 'scheduled')).conversations.length, 1);
    assert.equal((await api.readConversation(env, actor('cleo'), sent.conversation.id)).messages.length, 2);
    assert.equal((await api.getJobRow(env, sent.request.id)).retrieved_at, now);
    await assert.rejects(api.acknowledgeConversation(env, agent('cleo'), sent.conversation.id, 'scheduled', cursor + 10000), e => e.code === 'invalid_cursor');
  });
  await check('message retries deduplicate at a fixed timestamp and informational replies consume no new work quota', async () => {
    reset(); const [a, b] = await Promise.all([send({ idempotency_key: 'request-key' }), send({ idempotency_key: 'request-key' })]);
    assert.equal(a.request.id, b.request.id); assert.equal(count('jobs'), 1); assert.equal(count('conversation_messages'), 1);
    const replies = await Promise.all([send({ conversation_id: a.conversation.id, message: 'For reference only.', response_requested: false, idempotency_key: 'note-key' }), send({ conversation_id: a.conversation.id, message: 'For reference only.', response_requested: false, idempotency_key: 'note-key' })]);
    assert.equal(replies[0].message.id, replies[1].message.id); assert.equal(count('jobs'), 1); assert.equal(count('conversation_messages'), 2);
    await assert.rejects(send({ message: 'Conflicting prompt.', idempotency_key: 'request-key' }), e => e.code === 'idempotency_conflict');
  });
  await check('conversation participant and workspace boundaries prevent cross-agent history and replies', async () => {
    reset(); const sent = await send();
    await assert.rejects(api.readConversation(env, actor('stranger'), sent.conversation.id), e => e.status === 404);
    await assert.rejects(send({ conversation_id: sent.conversation.id, to: 'grok' }), e => e.code === 'wrong_participants');
    await assert.rejects(api.readConversation({ ...env, WORKSPACE_ID: 'elsewhere' }, actor('cleo'), sent.conversation.id), e => e.status === 403);
    await assert.rejects(api.claimRequest(env, agent('stranger'), sent.request.id, 'run'), e => e.status === 404);
    await assert.rejects(send({ to: '*' }), e => e.code === 'invalid_recipient');
  });
  await check('informational replies respect edited connection ACLs and idempotency includes request semantics', async () => {
    reset(); const sent = await send({ idempotency_key: 'semantic', constraints: ['Use public sources.'] });
    await assert.rejects(send({ idempotency_key: 'semantic', constraints: ['Use private sources.'] }), e => e.code === 'idempotency_conflict');
    sqlite.prepare("UPDATE agents SET request_targets='[]' WHERE id='cleo'").run();
    await assert.rejects(send({ conversation_id: sent.conversation.id, response_requested: false, message: 'An annotation.' }), e => e.code === 'collaborator_not_allowed');
    sqlite.prepare("UPDATE agents SET request_targets='[\"*\"]' WHERE id='cleo'").run();
    sqlite.prepare("UPDATE agents SET accept_from='[]' WHERE id='claude'").run();
    await assert.rejects(send({ conversation_id: sent.conversation.id, response_requested: false, message: 'An annotation.' }), e => e.code === 'collaborator_not_allowed');
  });
  await check('chain requests are atomically bounded across separate consultations and owner extensions are explicit', async () => {
    reset(); const rootRequest = await send();
    for (let i = 0; i < 8; i++) await send({ to: 'grok', parent_request_id: rootRequest.request.id, message: `Consultation ${i}.` }, 'claude');
    const contested = await Promise.allSettled([send({ parent_request_id: rootRequest.request.id, message: 'Last slot A.' }), send({ parent_request_id: rootRequest.request.id, message: 'Last slot B.' })]);
    assert.equal(contested.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(count('jobs'), 10);
    await assert.rejects(send({ conversation_id: rootRequest.conversation.id, message: 'Over limit.' }), e => e.code === 'conversation_limit');
    await assert.rejects(api.extendConversation(env, actor('cleo'), rootRequest.conversation.id, { requests: 1 }), e => e.status === 403);
    await api.extendConversation(env, owner, rootRequest.conversation.id, { requests: 1 });
    await send({ conversation_id: rootRequest.conversation.id, message: 'Extended follow-up.' });
    assert.equal(count('jobs'), 11);
  });
  await check('delegation depth is shared across children and follow-ups retain their original depth', async () => {
    reset(); const a = await send(); const b = await send({ to: 'grok', parent_request_id: a.request.id }, 'claude');
    const c = await send({ to: 'cleo', parent_request_id: b.request.id }, 'grok');
    assert.equal(c.request.delegation_depth, 2);
    await assert.rejects(send({ parent_request_id: c.request.id }), e => e.code === 'conversation_limit');
    const follow = await send({ to: 'grok', conversation_id: b.conversation.id, message: 'One follow-up.' }, 'claude');
    assert.equal(follow.request.delegation_depth, 1);
    await api.extendConversation(env, owner, a.conversation.id, { requests: 0, depth: 1 });
    assert.equal((await send({ parent_request_id: c.request.id })).request.delegation_depth, 3);
  });
  await check('stopping a chain invalidates claims and prevents descendant dispatch while preserving history', async () => {
    reset(); const a = await send(); const b = await send({ to: 'grok', parent_request_id: a.request.id }, 'claude');
    const held = await claim(a.request.id);
    await api.stopConversation(env, owner, a.conversation.id);
    assert.equal((await api.getJobRow(env, b.request.id)).status, 'canceled');
    assert.equal((await complete(held.token)).kind, 'unknown', 'Revoked claim capability is unusable');
    assert.equal((await api.readConversation(env, actor('cleo'), a.conversation.id)).messages.length, 1);
    await assert.rejects(send({ conversation_id: a.conversation.id, message: 'More work.' }), e => e.code === 'conversation_limit');
  });
  await check('history pagination at one timestamp has no gaps, repeated pages are stable, pickup omissions are explicit', async () => {
    reset(); const sent = await send();
    for (let i = 0; i < 15; i++) await send({ conversation_id: sent.conversation.id, response_requested: false, message: `Note ${i}.` });
    const first = await api.readConversation(env, actor('cleo'), sent.conversation.id, { limit: 7 });
    const again = await api.readConversation(env, actor('cleo'), sent.conversation.id, { limit: 7 });
    const second = await api.readConversation(env, actor('cleo'), sent.conversation.id, { after: first.next_cursor, limit: 100 });
    assert.deepEqual(first.messages, again.messages); assert.equal(first.has_more, true); assert.equal(second.has_more, false);
    assert.equal(new Set([...first.messages, ...second.messages].map(m => m.id)).size, 16);
    assert.equal((await claim(sent.request.id)).job.conversation_context.omitted_message_count, 8);
  });
  await check('policy edits block queued work before claim and receiver restrictions cannot be bypassed', async () => {
    reset(); const sent = await send();
    await api.updateCollaborationConfiguration(env, owner, 'claude', { allowed_work_categories: [] });
    assert.equal((await claim(sent.request.id)).job, null);
    assert.equal((await api.previewRequests(env, agent('claude'))).length, 0);
    await assert.rejects(send(), e => e.status === 403);
    await api.updateCollaborationConfiguration(env, owner, 'claude', { allowed_work_categories: ['task'], permitted_collaborators: ['grok'] });
    assert.equal((await claim(sent.request.id)).job, null);
  });
  await check('30-day retention protects a whole thread with pending work then removes all content atomically', async () => {
    reset(); const sent = await send({}, 'cleo', now - 40 * DAY); const held = await claim(sent.request.id, 'run', now - 40 * DAY); await complete(held.token, now - 40 * DAY);
    const follow = await send({ conversation_id: sent.conversation.id, message: 'Still outstanding.' }, 'cleo', now - 35 * DAY);
    await api.pruneConversations(env, now); assert.equal(count('conversation_messages'), 3);
    await api.transition(env, owner, follow.request.id, 'cancel', undefined, now - 34 * DAY);
    await api.pruneConversations(env, now); assert.equal(count('conversations'), 0); assert.equal(count('conversation_messages'), 0);
    assert.equal(count('jobs'), 2, 'Quota receipts remain');
    assert.equal((await api.getJobRow(env, sent.request.id)).spec, '{}');
    await assert.rejects(api.transition(env, owner, sent.request.id, 'reject', 'Revise after expiry.', now), e => e.code === 'conversation_expired');
  });
  await check('retention of old quota receipts never refunds an active chain request allowance', async () => {
    reset(); const old = now - 45 * DAY;
    const sent = await send({}, 'cleo', old); let held = await claim(sent.request.id, 'old-root', old); await complete(held.token, old);
    for (let i = 0; i < 8; i++) {
      const sibling = await send({ parent_request_id: sent.request.id, message: `Old sibling ${i}.` }, 'cleo', old);
      held = await claim(sibling.request.id, `old-${i}`, old); await complete(held.token, old);
    }
    const active = await send({ parent_request_id: sent.request.id, message: 'Still current.' });
    await api.pruneWorkspace(env, now);
    assert.equal(count('jobs'), 1);
    assert.equal((await api.readConversation(env, actor('cleo'), active.conversation.id)).conversation.requests_used, 10);
    await assert.rejects(send({ conversation_id: active.conversation.id, message: 'Budget must remain exhausted.' }), e => e.code === 'conversation_limit');
  });
  await check('informational replies reach send-only assistants and the owner without creating work', async () => {
    reset(); sqlite.prepare("UPDATE agents SET can_work=0,work_types='[]' WHERE id='cleo'").run();
    const sent = await send();
    const note = await api.sendMessage(env, actor('claude'), { conversation_id: sent.conversation.id, to: 'cleo', message: 'A useful update.', response_requested: false }, now);
    assert.equal(note.request, null); assert.equal(count('jobs'), 1);
    const human = await api.sendMessage(env, owner, { to: 'claude', message: 'Please review.' }, now);
    const answer = await api.sendMessage(env, actor('claude'), { conversation_id: human.conversation.id, to: 'owner', message: 'An informational reply.', response_requested: false }, now);
    assert.equal(answer.message.to, 'owner');
  });
  await check('pinned context is owner-scoped, versioned, immutable, and supplied in full at pickup', async () => {
    reset(); const sent = await send();
    await assert.rejects(api.updateConversationContext(env, actor('cleo'), sent.conversation.id, { pinned_context: 'Do not grant authority.' }), e => e.status === 403);
    await assert.rejects(api.updateConversationContext({ ...env, WORKSPACE_ID: 'another' }, owner, sent.conversation.id, { pinned_context: 'Foreign write.' }), e => e.status === 404);
    const first = await api.updateConversationContext(env, owner, sent.conversation.id, { pinned_context: 'Use these public links only.', expected_version: 0 }, now);
    assert.equal(first.conversation.context_version, 1); assert.equal(first.message.kind, 'context'); assert.equal(first.message.context.previous_text, '');
    const next = await api.updateConversationContext(env, owner, sent.conversation.id, { pinned_context: 'Updated shared brief.', expected_version: 1 }, now);
    assert.equal(next.message.context.previous_text, 'Use these public links only.'); assert.equal(next.message.context.version, 2);
    await assert.rejects(api.updateConversationContext(env, owner, sent.conversation.id, { pinned_context: 'Stale save.', expected_version: 1 }), e => e.code === 'context_changed');
    const noOp = await api.updateConversationContext(env, owner, sent.conversation.id, { pinned_context: 'Updated shared brief.', expected_version: 2 });
    assert.equal(noOp.message, null); assert.equal(noOp.conversation.context_version, 2);
    const pickup = await claim(sent.request.id);
    assert.equal(pickup.job.conversation_context.pinned_context, 'Updated shared brief.'); assert.equal(pickup.job.conversation_context.context_version, 2);
    assert.equal((await api.readConversation(env, actor('cleo'), sent.conversation.id)).messages.filter(m => m.kind === 'context').length, 2);
    assert.equal((await api.checkConversationInbox(env, agent('cleo'), 'reader')).conversations.length, 1, 'Both participants can discover a human context update');
    const races = await Promise.allSettled([
      api.updateConversationContext(env, owner, sent.conversation.id, { pinned_context: 'Concurrent A.', expected_version: 2 }, now),
      api.updateConversationContext(env, owner, sent.conversation.id, { pinned_context: 'Concurrent B.', expected_version: 2 }, now),
    ]);
    assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await api.readConversation(env, owner, sent.conversation.id)).messages.filter(m => m.kind === 'context').length, 3);
  });
  await check('pinned context counts against storage and oversized essential content requests a smaller brief', async () => {
    reset(); const sent = await send(); const usage = await api.getWorkspaceUsage(env, now);
    sqlite.prepare('UPDATE workspaces SET storage_limit_bytes=? WHERE id=?').run(usage.storage_bytes + 10, 'default');
    await assert.rejects(api.updateConversationContext(env, owner, sent.conversation.id, { pinned_context: 'A pin that cannot fit in the remaining storage.', expected_version: 0 }), e => e.code === 'storage_limit');
    assert.equal((await api.readConversation(env, owner, sent.conversation.id)).conversation.context_version, 0);
    assert.equal(count('conversation_messages'), 1);
    sqlite.prepare('UPDATE workspaces SET storage_limit_bytes=100000000').run();
    const large = await send({ message: 'G'.repeat(20000), constraints: Array.from({ length: 30 }, () => 'C'.repeat(1000)) });
    await api.updateConversationContext(env, owner, large.conversation.id, { pinned_context: 'P'.repeat(20000), expected_version: 0 });
    const afterPin = await api.getWorkspaceUsage(env, now); assert.ok(afterPin.storage_bytes >= 40000, 'Pin and immutable event are both counted');
    const pickup = await claim(large.request.id);
    assert.equal(pickup.job.conversation_context.pinned_context.length, 20000);
    assert.equal(pickup.job.conversation_context.context_requires_brief, true);
    assert.match(pickup.job.conversation_context.instruction, /smaller brief/);
    await assert.rejects(api.updateConversationContext(env, owner, large.conversation.id, { pinned_context: 'X'.repeat(20001) }), e => e.code === 'invalid_context');
  });
  await check('strict conversations use thirty-day retention while legacy jobs retain their workspace policy', async () => {
    reset(); sqlite.prepare('UPDATE workspaces SET retention_days=1').run();
    const strict = await send();
    const legacy = await api.createJob(env, 'cleo', agent('cleo'), { to: 'claude', type: 'task', title: 'Legacy retention', goal: 'Keep existing retention.' }, undefined, now);
    assert.equal(strict.conversation.retention_days, 30);
    assert.equal((await api.readConversation(env, owner, legacy.row.conversation_id)).conversation.retention_days, 1);
  });
  await check('retention removes pinned context and every prior revision with its complete thread', async () => {
    reset(); const old = now - 40 * DAY; const sent = await send({}, 'cleo', old); const held = await claim(sent.request.id, 'old', old); await complete(held.token, old);
    await api.updateConversationContext(env, owner, sent.conversation.id, { pinned_context: 'An earlier pin.' }, old);
    await api.updateConversationContext(env, owner, sent.conversation.id, { pinned_context: 'The latest pin.' }, old);
    const exported = await api.exportWorkspace(env); assert.equal(exported.conversations[0].pinned_context, 'The latest pin.');
    assert.match(exported.messages.find(m => m.kind === 'context' && m.text === 'The latest pin.').context, /An earlier pin/);
    await api.pruneConversations(env, now);
    assert.equal(count('conversations'), 0); assert.equal(count('conversation_messages'), 0);
  });
  await check('last message extends retention and minimal receipts cannot reset monthly quotas', async () => {
    reset(); const sent = await send({}, 'cleo', now - 29 * DAY); const held = await claim(sent.request.id, 'run', now - 29 * DAY); await complete(held.token, now - 29 * DAY);
    await send({ conversation_id: sent.conversation.id, message: 'A recent annotation.', response_requested: false }, 'cleo', now);
    await api.pruneWorkspace(env, now + 2 * DAY); assert.equal(count('conversation_messages'), 3);
    const exported = await api.exportWorkspace(env); assert.equal(exported.messages.length, 3); assert.equal(exported.version, 2);
    await api.deleteWorkspaceContents(env); assert.equal(count('conversations'), 0); assert.equal(count('conversation_chains'), 0); assert.equal(count('conversation_messages'), 0);
  });
  console.log(`\n${checks} conversation regressions passed; no network used.`);
} finally { globalThis.fetch = originalFetch; sqlite.close(); await rm(temp, { recursive: true, force: true }); }
