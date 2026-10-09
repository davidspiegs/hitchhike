#!/usr/bin/env node
/** Collaboration policies and proof use the migrated SQLite database, no provider calls. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-collaboration-test-'));
const sqlite = new DatabaseSync(':memory:');
const originalFetch = globalThis.fetch;
let afterRead = null, checks = 0;
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { const value = sqlite.prepare(this.sql).get(...this.values) ?? null; if (afterRead) await afterRead(this.sql, value); return value; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() { return { meta: sqlite.prepare(this.sql).run(...this.values), success: true }; }
}
const DB = { prepare: sql => new Statement(sql), async batch(statements) {
  sqlite.exec('BEGIN');
  try { const results=[]; for(const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
  catch(error) { sqlite.exec('ROLLBACK'); throw error; }
} };
const env = { DB, WORKSPACE_ID: 'default', HOSTED: 'true', ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const owner = { owner: true, agent: null };
const now = Date.now();
const check = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const row = id => sqlite.prepare('SELECT * FROM agents WHERE id=?').get(id);
const asAgent = id => ({ owner: false, agent: row(id) });
const rejects = (work, code) => assert.rejects(work, error => error.code === code);
function agent(id, platform = 'other', workspace = 'default') {
  sqlite.prepare(`INSERT INTO agents (id,workspace_id,handle,name,token_hash,can_request,can_work,work_types,created_at,platform,key_ciphertext,wake_headers)
    VALUES (?,?,?,?,?,1,1,'["task","research","review"]',?,?,?,?)`)
    .run(id, workspace, id, id, `secret-token-hash-${id}`, now, platform, `secret-encrypted-key-${id}`, `secret-wake-headers-${id}`);
}
function job(id, from = 'cleo', resultBy = 'claude', extras = {}) {
  const value = { id, workspace_id: 'default', v: '1', type: 'task', from_agent: from, to_agent: resultBy,
    title: 'Synthetic collaboration check', spec: '{}', status: 'completed', result: '{"summary":"done"}', result_by: resultBy,
    lease_seconds: 300, created_at: now - 100, updated_at: now, completed_at: now - 10, retrieved_at: now, ...extras };
  sqlite.prepare(`INSERT INTO jobs (${Object.keys(value).join(',')}) VALUES (${Object.keys(value).map(() => '?').join(',')})`).run(...Object.values(value));
}
globalThis.fetch = async () => { throw new Error('External requests forbidden'); };
try {
  for (const name of (await readdir(join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(root, 'migrations', name), 'utf8'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  const modulePath = join(temporary, 'collaboration.mjs');
  await build({ stdin: {contents:"export * from './src/collaboration'; export {redeemPairing,issuePairing} from './src/pairing'; export {sealAgentKey} from './src/crypto';",resolveDir:root}, bundle: true, platform: 'node', format: 'esm', outfile: modulePath, logLevel: 'silent' });
  const { getCollaborationConfiguration: get, updateCollaborationConfiguration: update, updateOnboardingProgress: progress,
    assertCollaborationAllowed: allow, getWorkspaceRelease, setWorkspaceRelease, recordVerifiedBackgroundRun: record, collaborationClaimSQL, redeemPairing, issuePairing, sealAgentKey } = await import(pathToFileURL(modulePath).href);
  agent('cleo', 'chatgpt'); agent('claude', 'claude'); agent('worker');
  sqlite.prepare("INSERT INTO workspaces(id,name,created_at) VALUES('elsewhere','Other workspace',?)").run(now);
  agent('foreign-agent', 'other', 'elsewhere');

  await check('migration defaults release off; selfhost opt-in never overrides hosted workspace', async () => {
    assert.equal((await getWorkspaceRelease(env)).enabled, false);
    assert.equal((await getWorkspaceRelease({ ...env, NEXT_RELEASE_BETA: 'true' })).enabled, false);
    assert.equal((await getWorkspaceRelease({ ...env, HOSTED: 'false', NEXT_RELEASE_BETA: 'true' })).enabled, true);
    await rejects(() => setWorkspaceRelease(env, asAgent('cleo'), { enabled: true }), 'owner_required');
    assert.equal((await setWorkspaceRelease(env, owner, { enabled: true })).enabled, true);
  });
  await check('configuration read is side-effect free, scoped and never leaks credentials', async () => {
    const config = await get(env, asAgent('cleo'));
    assert.equal(config.version, 0); assert.equal(config.settings.initiative, false);
    assert.deepEqual(config.settings.instructions, { profile: 'judgment', custom_prompt: null });
    assert.equal(config.settings.setup_background, null, 'an untouched connection has no saved scheduling choice');
    assert.match(config.settings.sharing.instructions, /Never automatically forward complete chats/);
    assert.deepEqual(config.roster.map(agent => agent.id).sort(), ['claude', 'worker']);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM agent_collaboration').get().n, 0);
    assert.doesNotMatch(JSON.stringify(config), /secret-/);
    assert.equal(config.runtime_instructions.version, 1); assert.equal(config.runtime_instructions.transport, 'mcp');
    assert.equal(config.runtime_instructions.protocol, 'conversations');
    assert.match(config.runtime_instructions.working_preference,/If helpful, you may use (?:your )?connected assistants/);
    assert.match(config.runtime_instructions.text, /current claim_id/);
    assert.ok(config.runtime_instructions.text.split(/\s+/).length <= 450);
    await rejects(() => get(env, asAgent('cleo'), 'claude'), 'configuration_private');
    await rejects(() => get(env, owner, 'foreign-agent'), 'agent_not_found');
    await rejects(() => get(env, { owner: false, agent: null }), 'unauthorized');
    await rejects(() => get(env, asAgent('foreign-agent')), 'wrong_workspace');
  });
  await check('only owner edits safe allowlisted fields and saves versioned preferences', async () => {
    await rejects(() => update(env, asAgent('cleo'), 'cleo', { purpose: 'unsafe' }), 'owner_required');
    await rejects(() => update(env, owner, 'cleo', { token: 'never-save-me' }), 'invalid_collaboration');
    const config = await update(env, owner, 'cleo', { expected_version: 0, purpose: 'Coordinate research and critique', initiative: true,
      standing_responsibilities: ['Review the weekly research plan'], authorization_boundaries: ['Ask before publishing'],
      sharing: { approved_sources: ['The project brief supplied by the user'], recipient_rules: [{ agent_id: 'claude', instructions: 'Share the plan only.', approved_sources: ['Plan text'] }] } });
    assert.equal(config.version, 1); assert.equal(config.settings.initiative, true);
    assert.equal(config.settings.sharing.recipient_rules[0].agent_id, 'claude');
    assert.equal((await update(env, owner, 'cleo', { expected_version: 1, purpose: config.settings.purpose })).version, 1, 'same save is idempotent');
    await rejects(() => update(env, owner, 'cleo', { expected_version: 0, purpose: 'Stale edit' }), 'configuration_changed');
  });
  await check('compare-and-swap refuses concurrent edits instead of losing a setting', async () => {
    afterRead = async (sql, value) => {
      if (sql.startsWith('SELECT * FROM agent_collaboration') && value?.agent_id === 'cleo') {
        afterRead = null;
        sqlite.prepare("UPDATE agent_collaboration SET version=version+1,settings=json_set(settings,'$.purpose','Concurrent owner edit') WHERE agent_id='cleo'").run();
      }
    };
    await rejects(() => update(env, owner, 'cleo', { expected_version: 1, purpose: 'Lost edit' }), 'configuration_changed');
    assert.equal((await get(env, owner, 'cleo')).settings.purpose, 'Concurrent owner edit');
  });
  await check('recipient/category policy applies both ways and filters roster', async () => {
    await update(env, owner, 'cleo', { permitted_collaborators: ['claude'], allowed_request_categories: ['review'] });
    await allow(env, asAgent('cleo'), 'claude', 'review');
    await rejects(() => allow(env, asAgent('cleo'), 'worker', 'review'), 'collaborator_not_allowed');
    await rejects(() => allow(env, asAgent('cleo'), 'claude', 'task'), 'category_not_allowed');
    assert.deepEqual((await get(env, asAgent('cleo'))).roster.map(peer => peer.id), ['claude']);
    await update(env, owner, 'claude', { allowed_work_categories: ['task'] });
    await rejects(() => allow(env, asAgent('cleo'), 'claude', 'review'), 'recipient_policy_denied');
    assert.deepEqual((await get(env, asAgent('cleo'))).roster, []);
    await update(env, owner, 'claude', { allowed_work_categories: ['review'], permitted_collaborators: [] });
    await rejects(() => allow(env, asAgent('cleo'), 'claude', 'review'), 'recipient_policy_denied');
  });
  await check('wildcard dispatch cannot bypass an eligible recipient policy', async () => {
    await update(env, owner, 'cleo', { permitted_collaborators: ['*'], allowed_request_categories: ['task','research','review'] });
    await rejects(() => allow(env, asAgent('cleo'), '*', 'review'), 'direct_recipient_required');
    await update(env, owner, 'claude', { permitted_collaborators: ['*'], allowed_work_categories: ['task','research','review'] });
    await allow(env, asAgent('cleo'), '*', 'review');
  });
  await check('legacy target and acceptance ACLs still constrain eligible roster', async () => {
    sqlite.prepare("UPDATE agents SET request_targets='[\"worker\"]' WHERE id='cleo'").run();
    assert.deepEqual((await get(env, asAgent('cleo'))).roster.map(peer => peer.id), ['worker']);
    sqlite.prepare("UPDATE agents SET accept_from='[]' WHERE id='worker'").run();
    assert.deepEqual((await get(env, asAgent('cleo'))).roster, []);
    sqlite.prepare("UPDATE agents SET request_targets='[\"*\"]' WHERE id='cleo'").run();
    sqlite.prepare("UPDATE agents SET accept_from='[\"*\"]' WHERE id='worker'").run();
  });
  await check('per-recipient private sharing rules do not leak through another agent roster', async () => {
    const config = await get(env, asAgent('claude'));
    const sender = config.roster.find(peer => peer.id === 'cleo');
    assert.ok(sender); assert.equal(sender.purpose, 'Concurrent owner edit');
    assert.equal(sender.sharing, undefined); assert.equal(sender.standing_responsibilities, undefined);
    assert.doesNotMatch(JSON.stringify(config.roster), /Share the plan only|Plan text/);
  });
  await check('saved UI progress resumes through Dots shared connection without manufacturing proof', async () => {
    const config = await progress(env, owner, 'cleo', { provider: 'chatgpt', surface: 'dots', step: 'instructions' });
    assert.equal(config.onboarding.surface, 'dots'); assert.equal(config.onboarding.step, 'instructions');
    assert.equal(config.readiness.access.verified, false); assert.equal(config.readiness.collaboration.verified, false);
    assert.equal(config.readiness.peer_collaboration.verified, false);
    assert.equal(config.readiness.background.verified, false);
    const finished = await progress(env, owner, 'cleo', { step: 'done' });
    assert.equal(finished.onboarding.step, 'done', 'the owner may finish before any observed checks');
    assert.deepEqual(finished.readiness, config.readiness, 'finishing records progress without manufacturing evidence');
    const resumed = await progress(env, owner, 'cleo', { surface: 'dots' });
    assert.equal(resumed.onboarding.step, 'done', 'editing the surface preserves finished progress');
    assert.deepEqual(resumed.readiness, config.readiness);
    await progress(env, owner, 'cleo', { step: 'exchange' });
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM agents WHERE id='cleo'").get().n, 1);
    await rejects(() => progress(env, owner, 'cleo', { provider: 'claude' }), 'invalid_collaboration');
    await rejects(() => progress(env, owner, 'cleo', { surface: 'cloud' }), 'invalid_collaboration');
    await rejects(() => progress(env, owner, 'cleo', { token: 'no' }), 'invalid_collaboration');
    await rejects(() => progress(env, asAgent('cleo'), 'cleo', { step: 'done' }), 'owner_required');
  });
  await check('observed connection contact does not imply roundtrip or background execution', async () => {
    sqlite.prepare("UPDATE agents SET last_seen_at=? WHERE id='cleo'").run(now);
    const config = await get(env, asAgent('cleo'));
    assert.equal(config.readiness.access.verified, true);
    assert.match(config.readiness.access.note, /does not verify send/);
    assert.equal(config.readiness.collaboration.verified, false); assert.equal(config.readiness.background.verified, false);
    const finished = await progress(env, owner, 'cleo', { step: 'done' });
    assert.equal(finished.onboarding.step, 'done'); assert.deepEqual(finished.readiness, config.readiness);
  });
  await check('website marker tests and self-addressed answers are not peer collaboration proof', async () => {
    job('owner-marker', 'owner', 'cleo');
    job('self-marker', 'cleo', 'cleo');
    job('unknown-peer', 'cleo', 'missing-connection');
    job('foreign-peer', 'cleo', 'foreign-agent');
    const readiness = (await get(env, owner, 'cleo')).readiness;
    assert.equal(readiness.collaboration.verified, true, 'legacy connection-test milestone is retained');
    assert.equal(readiness.peer_collaboration.verified, false);
    const finished = await progress(env, owner, 'cleo', { step: 'done' });
    assert.equal(finished.onboarding.step, 'done'); assert.deepEqual(finished.readiness, readiness);
    sqlite.prepare("DELETE FROM jobs WHERE id IN ('owner-marker','self-marker','unknown-peer','foreign-peer')").run();
  });
  await check('an unretrieved answer is not a completed collaboration milestone', async () => {
    job('roundtrip-1', 'cleo', 'claude', { retrieved_at: null });
    assert.equal((await get(env, asAgent('cleo'))).readiness.collaboration.verified, false);
    const unverified = await progress(env, owner, 'cleo', { step: 'done' });
    assert.equal(unverified.onboarding.step, 'done');
    assert.equal(unverified.readiness.collaboration.verified, false);
    assert.equal(unverified.readiness.peer_collaboration.verified, false);
    sqlite.prepare("UPDATE jobs SET retrieved_at=? WHERE id='roundtrip-1'").run(now);
    const readiness = (await get(env, asAgent('cleo'))).readiness;
    assert.equal(readiness.collaboration.verified, true); assert.equal(readiness.collaboration.request_id, 'roundtrip-1');
    assert.equal(readiness.peer_collaboration.verified, true);
    assert.equal((await progress(env, owner, 'cleo', { step: 'done' })).onboarding.step, 'done');
    const receiver = await progress(env, owner, 'claude', { step: 'done' });
    assert.equal(receiver.onboarding.step, 'done');
    assert.equal(receiver.readiness.access.verified, false, 'finishing does not invent authenticated contact');
    assert.equal(receiver.readiness.peer_collaboration.verified, true, 'peer evidence is independent of completion');
    sqlite.prepare("UPDATE agents SET last_seen_at=? WHERE id='claude'").run(now);
    assert.equal((await progress(env, owner, 'claude', { step: 'done' })).onboarding.step, 'done', 'a receiving assistant can finish after a peer exchange');
    assert.equal(readiness.background.verified, false);
  });
  await check('finishing remains allowed when observed evidence disappears during the save', async () => {
    await progress(env, owner, 'cleo', { step: 'exchange' });
    afterRead = async (sql, value) => {
      if (sql.startsWith('SELECT * FROM agent_onboarding') && value?.step === 'exchange') {
        afterRead = null;
        sqlite.prepare("UPDATE agents SET last_seen_at=NULL WHERE id='cleo'").run();
      }
    };
    const finished = await progress(env, owner, 'cleo', { step: 'done' });
    assert.equal(finished.onboarding.step, 'done');
    assert.equal(finished.readiness.access.verified, false, 'the response reports current evidence without restoring it');
    assert.equal(finished.readiness.peer_collaboration.verified, true);
    assert.equal(finished.readiness.background.verified, false);
    assert.equal((await get(env, owner, 'cleo')).onboarding.step, 'done');
    sqlite.prepare("UPDATE agents SET last_seen_at=? WHERE id='cleo'").run(now);
    assert.equal((await progress(env, owner, 'cleo', { step: 'done' })).onboarding.step, 'done');
  });
  await check('an interval and an owner claim of verification cannot prove background execution', async () => {
    const config = await update(env, owner, 'claude', { background: { method: 'scheduled', interval_minutes: 60 } });
    assert.equal(config.settings.background.interval_minutes, 60); assert.equal(config.readiness.background.verified, false);
    await rejects(() => update(env, owner, 'claude', { background: { method: 'scheduled', verified: true } }), 'invalid_collaboration');
  });
  await check('only two distinct correlated completed and retrieved adapter runs satisfy background proof', async () => {
    job('roundtrip-2');
    const evidence = { agent_id: 'claude', run_id: 'provider-run-1', method: 'scheduled', request_id: 'roundtrip-1' };
    assert.equal((await record(env, evidence, now)).recorded, true);
    assert.equal((await record(env, evidence, now)).recorded, false);
    assert.equal((await get(env, owner, 'claude')).readiness.background.verified, false);
    await record(env, { ...evidence, run_id: 'provider-run-2', request_id: 'roundtrip-2' }, now + 60000);
    const background = (await get(env, owner, 'claude')).readiness.background;
    assert.equal(background.verified, true); assert.equal(background.observed_runs, 2);
    assert.equal((await get(env, owner, 'cleo')).readiness.background.verified, false, 'one side proof never establishes the other side');
    assert.equal((await record(env, { ...evidence, run_id: 'foreign', request_id: 'not-in-this-workspace' })).recorded, false);
  });
  await check('validation bounds configuration and refuses cross-workspace recipients', async () => {
    await rejects(() => update(env, owner, 'cleo', { permitted_collaborators: ['foreign-agent'] }), 'invalid_collaboration');
    await rejects(() => update(env, owner, 'cleo', { permitted_collaborators: ['cleo'] }), 'invalid_collaboration');
    await rejects(() => update(env, owner, 'cleo', { permitted_collaborators: ['*','claude'] }), 'invalid_collaboration');
    await rejects(() => update(env, owner, 'cleo', { allowed_request_categories: ['unknown'] }), 'invalid_collaboration');
    await rejects(() => update(env, owner, 'cleo', { background: { interval_minutes: 0 } }), 'invalid_collaboration');
    await rejects(() => update(env, owner, 'cleo', { sharing: { instructions: 'x'.repeat(4001) } }), 'invalid_collaboration');
    await rejects(() => update(env, owner, 'cleo', { sharing: { recipient_rules: [{ agent_id:'claude' }, { agent_id:'claude' }] } }), 'invalid_collaboration');
  });
  await check('instruction choices and exact edited text persist without widening authority', async () => {
    const before = await get(env, owner, 'worker'), authority = { ...before.settings };
    delete authority.instructions;
    const agentBefore = row('worker');
    const custom = '  My private edited instructions.\nKeep this formatting.\n';
    let config = await update(env, owner, 'worker', { expected_version: 0, instructions: { profile: 'offload', custom_prompt: custom } });
    assert.deepEqual(config.settings.instructions, { profile: 'offload', custom_prompt: custom });
    assert.deepEqual((await get(env, asAgent('worker'))).settings.instructions, config.settings.instructions);
    for (const profile of ['judgment', 'available', 'delegate', 'collaborate', 'second_opinion']) {
      config = await update(env, owner, 'worker', { expected_version: config.version, instructions: { profile } });
      assert.deepEqual(config.settings.instructions, { profile, custom_prompt: custom }, 'profile selection preserves edited content');
      const unchanged = { ...config.settings }; delete unchanged.instructions;
      assert.deepEqual(unchanged, authority);
      assert.deepEqual(row('worker'), agentBefore);
    }
    assert.doesNotMatch(JSON.stringify((await get(env, asAgent('cleo'))).roster), /My private edited instructions/);
    await rejects(() => update(env, asAgent('worker'), 'worker', { instructions: { profile: 'delegate' } }), 'owner_required');
    await rejects(() => update(env, owner, 'worker', { expected_version: 0, instructions: { profile: 'delegate' } }), 'configuration_changed');
    const version = config.version;
    assert.equal((await update(env, owner, 'worker', { expected_version: version, instructions: config.settings.instructions })).version, version, 'identical save is idempotent');
    config = await update(env, owner, 'worker', { expected_version: version, instructions: { custom_prompt: null } });
    assert.deepEqual(config.settings.instructions, { profile: 'second_opinion', custom_prompt: null }, 'null explicitly resets to generated instructions');
  });
  await check('older instruction settings normalize on read without rewriting stored policy', async () => {
    sqlite.prepare("UPDATE agent_collaboration SET settings=json_remove(settings,'$.instructions') WHERE agent_id='worker'").run();
    const stored = sqlite.prepare("SELECT * FROM agent_collaboration WHERE agent_id='worker'").get();
    assert.deepEqual((await get(env, owner, 'worker')).settings.instructions, { profile: 'judgment', custom_prompt: null });
    assert.deepEqual(sqlite.prepare("SELECT * FROM agent_collaboration WHERE agent_id='worker'").get(), stored, 'reading does not migrate or version the row');
    const saved = await update(env, owner, 'worker', { expected_version: stored.version, instructions: { profile: 'offload' } });
    assert.deepEqual(saved.settings.instructions, { profile: 'offload', custom_prompt: null });
    assert.equal(saved.version, stored.version + 1);
  });
  await check('instruction fields reject invalid profiles, forged authority and oversize text', async () => {
    const before = await get(env, owner, 'worker');
    for (const instructions of [null, [], { profile: 'always-on' }, { profile: 1 }, { custom_prompt: 1 }, { custom_prompt: 'x'.repeat(16001) }, { profile: 'delegate', initiative: true }]) {
      await rejects(() => update(env, owner, 'worker', { instructions }), 'invalid_collaboration');
    }
    assert.equal((await get(env, owner, 'worker')).version, before.version);
    const maximum = 'x'.repeat(16000);
    const config = await update(env, owner, 'worker', { instructions: { custom_prompt: maximum } });
    assert.equal(config.settings.instructions.custom_prompt.length, 16000);
    await rejects(() => update(env, owner, 'worker', { sharing: { approved_sources: Array.from({ length: 30 }, (_, i) => `${i}:` + 's'.repeat(600)) } }), 'invalid_collaboration');
    assert.deepEqual((await get(env, owner, 'worker')).settings, config.settings, 'aggregate-size rejection preserves the last saved prompt');
  });
  await check('prompt storage admission preserves the prior version and text on quota failure', async () => {
    await update(env, owner, 'worker', { instructions: { custom_prompt: null } });
    const before = await get(env, owner, 'worker');
    const limit = sqlite.prepare("SELECT storage_limit_bytes FROM workspaces WHERE id='default'").get().storage_limit_bytes;
    const used = sqlite.prepare("SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id='default'").get().accounted_bytes;
    sqlite.prepare("UPDATE workspaces SET storage_limit_bytes=? WHERE id='default'").run(used + 100);
    try {
      await assert.rejects(() => update(env, owner, 'worker', { expected_version: before.version, instructions: { custom_prompt: 's'.repeat(16000) } }), /storage_limit/);
      const after = await get(env, owner, 'worker');
      assert.equal(after.version, before.version); assert.deepEqual(after.settings, before.settings);
    } finally { sqlite.prepare("UPDATE workspaces SET storage_limit_bytes=? WHERE id='default'").run(limit); }
  });
  await check('saved setup scheduling choice persists without changing execution policy or proof', async () => {
    const before = await get(env, owner, 'worker'), agentBefore = row('worker');
    const unchangedSettings = { ...before.settings }; delete unchangedSettings.setup_background;
    let config = before;
    for (const interval_minutes of [5, 60, 10080]) {
      config = await update(env, owner, 'worker', { expected_version: config.version, setup_background: { enabled: true, interval_minutes } });
      assert.deepEqual(config.settings.setup_background, { enabled: true, interval_minutes });
      assert.deepEqual((await get(env, asAgent('worker'))).settings.setup_background, config.settings.setup_background, 'the receiving assistant can read saved intent');
      const settings = { ...config.settings }; delete settings.setup_background;
      assert.deepEqual(settings, unchangedSettings, 'background execution, initiative, sharing and permission settings are unchanged');
      assert.deepEqual(config.readiness, before.readiness, 'a scheduling preference is not execution evidence');
      assert.deepEqual(row('worker'), agentBefore, 'the choice does not configure or wake a provider');
    }
    const saved = sqlite.prepare("SELECT settings FROM agent_collaboration WHERE agent_id='worker'").get();
    assert.deepEqual(JSON.parse(saved.settings).setup_background, { enabled: true, interval_minutes: 10080 });
    const version = config.version;
    assert.equal((await update(env, owner, 'worker', { expected_version: version, setup_background: config.settings.setup_background })).version, version, 'repeated choices are idempotent');
    for (const selection of [{ enabled: false }, { enabled: false, interval_minutes: null }, { enabled: false, interval_minutes: 60 }]) {
      config = await update(env, owner, 'worker', { expected_version: config.version, setup_background: selection });
      assert.deepEqual(config.settings.setup_background, { enabled: false, interval_minutes: null }, 'disabled choices normalize their unused interval');
      assert.deepEqual(config.readiness, before.readiness);
    }
    config = await update(env, owner, 'worker', { expected_version: config.version, setup_background: null });
    assert.equal(config.settings.setup_background, null, 'null explicitly clears the setup choice');
    assert.equal((await get(env, asAgent('worker'))).settings.setup_background, null);
  });
  await check('old or malformed setup choices normalize without rewriting existing rows', async () => {
    const original = sqlite.prepare("SELECT * FROM agent_collaboration WHERE agent_id='worker'").get();
    for (const selection of [undefined, null, true, [], {}, { enabled: 'yes', interval_minutes: 60 }, { enabled: true }, { enabled: true, interval_minutes: 0 }, { enabled: true, interval_minutes: 10081 }]) {
      const settings = JSON.parse(original.settings);
      if (selection === undefined) delete settings.setup_background;
      else settings.setup_background = selection;
      sqlite.prepare("UPDATE agent_collaboration SET settings=? WHERE agent_id='worker'").run(JSON.stringify(settings));
      const stored = sqlite.prepare("SELECT * FROM agent_collaboration WHERE agent_id='worker'").get();
      assert.equal((await get(env, owner, 'worker')).settings.setup_background, null);
      assert.deepEqual(sqlite.prepare("SELECT * FROM agent_collaboration WHERE agent_id='worker'").get(), stored, 'reading does not migrate or version a saved row');
    }
    sqlite.prepare("UPDATE agent_collaboration SET settings=? WHERE agent_id='worker'").run(original.settings);
  });
  await check('setup choices require owner authority, strict fields and whole bounded intervals', async () => {
    const before = await get(env, owner, 'worker');
    await rejects(() => update(env, asAgent('worker'), 'worker', { setup_background: { enabled: true, interval_minutes: 60 } }), 'owner_required');
    await rejects(() => update(env, { owner: false, agent: null }, 'worker', { setup_background: null }), 'owner_required');
    await rejects(() => update(env, owner, 'foreign-agent', { setup_background: null }), 'agent_not_found');
    const invalid = [false, [], 'scheduled', {}, { enabled: 1 }, { enabled: true }, { enabled: true, interval_minutes: null },
      { enabled: true, interval_minutes: 60, verified: true }, { enabled: false, method: 'manual' }];
    for (const enabled of [true, false]) {
      for (const interval_minutes of [0, 1, 4, -1, 10081, 5.5, '60', true, [], {}, Number.MAX_SAFE_INTEGER + 1]) invalid.push({ enabled, interval_minutes });
    }
    for (const setup_background of invalid) await rejects(() => update(env, owner, 'worker', { setup_background }), 'invalid_collaboration');
    const after = await get(env, owner, 'worker');
    assert.equal(after.version, before.version); assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.readiness, before.readiness);
  });
  await check('setup choices obey optimistic concurrency and preserve the winning owner edit', async () => {
    const before = await get(env, owner, 'worker');
    const saved = await update(env, owner, 'worker', { expected_version: before.version, setup_background: { enabled: true, interval_minutes: 15 } });
    await rejects(() => update(env, owner, 'worker', { expected_version: before.version, setup_background: { enabled: false } }), 'configuration_changed');
    assert.deepEqual((await get(env, owner, 'worker')).settings.setup_background, saved.settings.setup_background);
    afterRead = async (sql, value) => {
      if (sql.startsWith('SELECT * FROM agent_collaboration') && value?.agent_id === 'worker') {
        afterRead = null;
        sqlite.prepare("UPDATE agent_collaboration SET version=version+1,settings=json_set(settings,'$.setup_background.interval_minutes',30) WHERE agent_id='worker'").run();
      }
    };
    await rejects(() => update(env, owner, 'worker', { expected_version: saved.version, setup_background: { enabled: false } }), 'configuration_changed');
    const concurrent = await get(env, owner, 'worker');
    assert.equal(concurrent.version, saved.version + 1);
    assert.deepEqual(concurrent.settings.setup_background, { enabled: true, interval_minutes: 30 });
    assert.deepEqual(concurrent.readiness, before.readiness);
  });
  await check('atomic claim predicate rechecks queued work after sender or recipient policy changes', async () => {
    job('queued-policy-check', 'cleo', 'claude', { status: 'queued', result: null, completed_at: null, retrieved_at: null });
    const query = `SELECT j.id FROM jobs j WHERE j.id='queued-policy-check' AND ${collaborationClaimSQL('j', '?1')}`;
    const available = () => !!sqlite.prepare(query).get('claude');
    assert.equal(available(), true);
    await update(env, owner, 'cleo', { permitted_collaborators: ['worker'] });
    assert.equal(available(), false, 'sender collaborator change applies to already queued work');
    await update(env, owner, 'cleo', { permitted_collaborators: ['*'], allowed_request_categories: ['review'] });
    assert.equal(available(), false, 'sender category change applies to already queued work');
    await update(env, owner, 'cleo', { allowed_request_categories: ['task','review'] });
    assert.equal(available(), true);
    await update(env, owner, 'claude', { allowed_work_categories: ['review'] });
    assert.equal(available(), false, 'recipient category change applies to already queued work');
    await update(env, owner, 'claude', { allowed_work_categories: ['task','review'], permitted_collaborators: [] });
    assert.equal(available(), false, 'recipient collaborator change applies to already queued work');
    await update(env, owner, 'claude', { permitted_collaborators: ['*'] });
    assert.equal(available(), true);
    assert.throws(() => collaborationClaimSQL('j; DROP TABLE jobs', '?1'));
  });
  await check('removing a connection cleans its private config and progress without locking other edits', async () => {
    await update(env, owner, 'cleo', { permitted_collaborators: ['worker'] });
    await update(env, owner, 'worker', { purpose: 'Temporary worker' });
    await progress(env, owner, 'worker', { step: 'connect' });
    sqlite.prepare("DELETE FROM agents WHERE id='worker'").run();
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM agent_collaboration WHERE agent_id='worker'").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM agent_onboarding WHERE agent_id='worker'").get().n, 0);
    assert.equal((await update(env, owner, 'cleo', { purpose: 'Edited after collaborator removal' })).settings.purpose, 'Edited after collaborator removal');
    assert.deepEqual((await get(env, asAgent('cleo'))).roster, []);
  });
  await check('reading retained profile IDs and custom text never rewrites saved preferences', async () => {
    const custom = '  Keep my own wording exactly.\n';
    for (const profile of ['delegate','offload','collaborate','second_opinion']) {
      await update(env,owner,'cleo',{instructions:{profile,custom_prompt:custom}});
      const stored=sqlite.prepare("SELECT * FROM agent_collaboration WHERE agent_id='cleo'").get();
      const config=await get(env,asAgent('cleo'));
      assert.deepEqual(config.settings.instructions,{profile,custom_prompt:custom});
      assert.deepEqual(sqlite.prepare("SELECT * FROM agent_collaboration WHERE agent_id='cleo'").get(),stored);
      assert.doesNotMatch(config.runtime_instructions.text,/Keep my own wording/, 'working preferences remain in settings, not duplicated in protocol');
      assert.equal(config.runtime_instructions.working_preference,null,'custom preference is read directly from settings without duplication');
    }
  });
  await check('beta pairing returns current working preference and authenticated runtime bootstrap without embedding the credential', async () => {
    sqlite.prepare('INSERT INTO users(id,google_sub,email,name,workspace_id,created_at) VALUES (?,?,?,?,?,?)')
      .run('pairing-owner','synthetic-pairing-owner','pairing-owner@example.test','Pairing owner','default',now);
    agent('paired-helper','grok-bot');
    const token='synthetic-paired-helper-token';
    sqlite.prepare("UPDATE agents SET key_ciphertext=? WHERE id='paired-helper'").run(await sealAgentKey(env.ENCRYPTION_KEY,'paired-helper',token));
    async function code() {
      const value='pair_'+randomBytes(12).toString('base64url');
      sqlite.prepare('INSERT INTO pairing_codes(code_hash,workspace_id,agent_id,auth_generation,created_at,expires_at) VALUES (?,?,?,?,?,?)')
        .run(createHash('sha256').update(value).digest('hex'),'default','paired-helper',row('paired-helper').auth_generation,now,now+600000);
      return value;
    }
    const generated=await update(env,owner,'paired-helper',{instructions:{profile:'available',custom_prompt:null}});
    assert.match(generated.runtime_instructions.working_preference,/You may help my other assistants with tasks and research/);
    const firstCode=await code(), paired=await redeemPairing(env,firstCode,'https://relay.example.test',now);
    assert.equal(paired.token,token); assert.deepEqual(paired.working_preference,generated.settings.instructions);
    assert.match(paired.instructions,/You may help my other assistants with tasks and research/);
    assert.match(paired.instructions,/GET \/v1\/me/);assert.match(paired.instructions,/GET \/v1\/configuration/);
    assert.match(paired.instructions,/runtime_instructions/); assert.doesNotMatch(paired.instructions,/synthetic-paired-helper-token/);
    assert.equal((paired.instructions.match(/GET \/v1\/configuration/g)||[]).length,1,'bootstrap is not repeated');
    await rejects(()=>redeemPairing(env,firstCode,'https://relay.example.test',now),'invalid_pairing');
    const custom='  Prefer helping with incoming research.\nAsk peers only if I need it.\n';
    await update(env,owner,'paired-helper',{instructions:{profile:'offload',custom_prompt:custom}});
    const edited=await redeemPairing(env,await code(),'https://relay.example.test',now);
    assert.deepEqual(edited.working_preference,{profile:'offload',custom_prompt:custom});
    assert.ok(edited.instructions.endsWith(custom));assert.match(edited.instructions,/versioned runtime_instructions/);
    const config=await get(env,asAgent('paired-helper'));
    assert.equal(config.runtime_instructions.transport,'http');assert.ok(config.runtime_instructions.text.split(/\s+/).length<=700);
    assert.doesNotMatch(JSON.stringify(config),/synthetic-paired-helper-token/);
    await update(env,owner,'paired-helper',{setup_background:{enabled:true,interval_minutes:10}});
    const invitation=await issuePairing(env,'paired-helper','https://relay.example.test',now);
    assert.match(invitation.instructions,/routine every 10 minutes/);
    assert.match(invitation.instructions,/Reuse a matching active task/);
    assert.match(invitation.instructions,/saved working preferences/);
    assert.doesNotMatch(invitation.instructions,/synthetic-paired-helper-token|two.*runs|manual exchange/i);
    const accepted=await redeemPairing(env,invitation.code,'https://relay.example.test',now);
    assert.ok(accepted.instructions.endsWith(custom));
    assert.doesNotMatch(accepted.instructions,/Create a|routine every/,'redemption does not issue the scheduling request a second time');
    await update(env,owner,'paired-helper',{setup_background:{enabled:false,interval_minutes:null}});
    const manual=await issuePairing(env,'paired-helper','https://relay.example.test',now);
    assert.doesNotMatch(manual.instructions,/Create a|routine every/);
    await setWorkspaceRelease(env,owner,{enabled:false});
    const legacy=await redeemPairing(env,await code(),'https://relay.example.test',now);
    assert.equal(legacy.working_preference,undefined);assert.match(legacy.instructions,/synthetic-paired-helper-token/);
    assert.match(legacy.instructions,/\/v1\/work\/next/);assert.doesNotMatch(legacy.instructions,/runtime_instructions/);
    assert.equal((await get(env,asAgent('paired-helper'))).runtime_instructions.protocol,'jobs');
  });
  console.log(`\n${checks} collaboration checks passed.`);
} finally {
  globalThis.fetch = originalFetch; sqlite.close(); await rm(temporary, { recursive: true, force: true });
}
