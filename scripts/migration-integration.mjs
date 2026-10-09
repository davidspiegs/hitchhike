#!/usr/bin/env node
/** Split-origin service integration: real Clerk SDK signature checks and Worker
 * routing, synthetic identities, migrated SQLite, and no external requests.
 * This checks HTTP contracts; browser CORS/CSP enforcement needs browser QA. */
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-migration-test-'));
const sqlite = new DatabaseSync(':memory:');
const originalFetch = globalThis.fetch;
const apiOrigin = 'https://api.migration.example.test';
const uiOrigin = 'https://migration.example.test';
const issuer = 'https://migration-fixture.clerk.accounts.dev';
const callbackUri = 'http://127.0.0.1:8123/callback';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const profiles = new Map();
let checks = 0;
let providerCalls = 0;

class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() { return { meta: sqlite.prepare(this.sql).run(...this.values), success: true }; }
}
const DB = {
  prepare: sql => new Statement(sql),
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const env = {
  DB, HOSTED: 'true', AUTH_PROVIDER: 'clerk', SIGNUP_MODE: 'public',
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  GLOBAL_RATE_LIMITER: { limit: async () => ({ success: true }) },
  PUBLIC_URL: apiOrigin, FRONTEND_URL: uiOrigin,
  ENCRYPTION_KEY: 'synthetic-migration-encryption-fixture-only',
  CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from(new URL(issuer).hostname + '$').toString('base64'),
  CLERK_SECRET_KEY: 'sk_test_synthetic_migration_fixture_only',
  CLERK_ISSUER: issuer, CLERK_ALLOW_DEVELOPMENT: 'true',
  CLERK_JWT_KEY: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
};
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function tokenFor(identity, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, azp: uiOrigin, sub: identity.sub, sid: identity.sid,
    iat: now, nbf: now - 1, exp: now + 120, v: 2, fva: [0, -1], sts: 'active', ...overrides };
  for (const key of Object.keys(claims)) if (claims[key] === undefined) delete claims[key];
  const unsigned = encode({ alg: 'RS256', typ: 'JWT', kid: 'migration-fixture' }) + '.' + encode(claims);
  return unsigned + '.' + createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
}
function identity(label) {
  const result = { sub: 'user_migration_' + label, sid: 'sess_migration_' + label };
  const emailId = 'idn_migration_' + label;
  profiles.set(result.sub, { object: 'user', id: result.sub, first_name: 'Synthetic', last_name: label,
    primary_email_address_id: emailId, email_addresses: [{ object: 'email_address', id: emailId,
      email_address: label + '@example.test', verification: { status: 'verified', strategy: 'email_code' }, linked_to: [] }],
    external_accounts: [], phone_numbers: [], web3_wallets: [], passkeys: [],
    public_metadata: {}, private_metadata: {}, unsafe_metadata: {}, banned: false, locked: false,
    created_at: Date.now(), updated_at: Date.now() });
  return result;
}
globalThis.fetch = async (input, options) => {
  const request = input instanceof Request ? input : new Request(input, options);
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://api.clerk.com', 'All upstream calls must hit mocked Clerk endpoints');
  assert.equal(request.headers.get('authorization'), 'Bearer ' + env.CLERK_SECRET_KEY);
  providerCalls++;
  const id = url.pathname.match(/^\/v1\/users\/([^/]+)$/)?.[1];
  if (id && request.method === 'GET' && profiles.has(id)) return Response.json(profiles.get(id));
  const session = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/revoke$/)?.[1];
  if (session && request.method === 'POST') return Response.json({ object: 'session', id: session, status: 'revoked' });
  throw new Error('Unexpected upstream request in isolated migration test');
};
const check = async (name, work) => { await work(); console.log(`ok ${++checks} - ${name}`); };
const denied = result => assert.ok(result.status >= 400 && result.status < 500, 'Request must be denied without a server error');
const allowedCors = result => {
  assert.equal(result.headers.get('access-control-allow-origin'), uiOrigin);
  assert.match(result.headers.get('vary') ?? '', /(?:^|,\s*)Origin(?:,|$)/i);
  assert.notEqual(result.headers.get('access-control-allow-origin'), '*');
};

try {
  await check('workflow migrations preserve lease generations and existing schedule occurrence slots', async () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      const migrations = (await readdir(join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort();
      for (const file of migrations.filter(f => f < '0009')) legacy.exec(await readFile(join(root, 'migrations', file), 'utf8'));
      const thread = JSON.stringify([
        { kind: 'question', from: 'worker', at: '2026-09-01T00:00:01.000Z', text: 'First?' },
        { kind: 'reply', from: 'owner', at: '2026-09-01T00:00:02.000Z', text: 'Answer.' },
        { kind: 'question', from: 'worker', at: '2026-09-01T00:00:03.000Z', text: 'Last?' },
      ]);
      legacy.prepare(`INSERT INTO jobs(id,v,type,from_agent,to_agent,title,spec,status,thread,lease_seconds,attempts,max_attempts,created_at,updated_at)
        VALUES ('existing','0.1','task','owner','worker','Existing task','{}','input_required',?,60,2,2,1,1)`).run(thread);
      legacy.exec("INSERT INTO schedules(id,every_minutes,template,next_run_at,last_attempt_at,created_at) VALUES ('existing',5,'{}',123,456,1)");
      for (const file of migrations.filter(f => f >= '0009')) legacy.exec(await readFile(join(root, 'migrations', file), 'utf8'));
      const job = legacy.prepare("SELECT * FROM jobs WHERE id='existing'").get();
      assert.equal(job.attempts, 2); assert.equal(job.clarification_rounds, 1); assert.equal(job.status, 'input_required');
      const schedule = legacy.prepare("SELECT * FROM schedules WHERE id='existing'").get();
      assert.equal(schedule.next_run_at, 123); assert.equal(schedule.next_attempt_at, 123); assert.equal(schedule.last_attempt_at, 456);
      assert.equal(schedule.consecutive_failures, 0); assert.equal(schedule.attempt_token, null); assert.equal(schedule.enabled, 1);
    } finally { legacy.close(); }
  });
  for (const file of (await readdir(join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(root, 'migrations', file), 'utf8'));
  const modulePath = join(temporary, 'worker.mjs');
  await build({ entryPoints: [join(root, 'src/index.ts')], bundle: true, platform: 'node', format: 'esm', outfile: modulePath, logLevel: 'silent' });
  const { default: worker } = await import(pathToFileURL(modulePath).href);
  async function req(path, { method = 'GET', token, origin, csrf, body, form, headers = {}, host = apiOrigin, settings = env } = {}) {
    const h = new Headers({ accept: 'application/json', ...headers });
    if (token) h.set('authorization', 'Bearer ' + token);
    if (origin !== undefined) h.set('origin', origin);
    if (csrf) h.set('x-csrf-token', csrf);
    let payload;
    if (body !== undefined) { h.set('content-type', 'application/json'); payload = JSON.stringify(body); }
    if (form) { h.set('content-type', 'application/x-www-form-urlencoded'); payload = new URLSearchParams(form); }
    const background = [];
    const response = await worker.fetch(new Request(host + path, { method, headers: h, body: payload }), settings,
      { waitUntil: promise => background.push(promise), passThroughOnException() {} });
    for (const result of await Promise.allSettled(background)) assert.equal(result.status, 'fulfilled', 'Background work must succeed');
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { /* Redirects and native HTML intentionally have no JSON. */ }
    return { status: response.status, headers: response.headers, text, data };
  }
  const alice = identity('alice'), bob = identity('bob');
  const aliceToken = tokenFor(alice), bobToken = tokenFor(bob);
  let aliceSession, bobSession, sender, receiver, receiverToken, clientId, native;
  const owner = (path, options = {}) => req(path, { token: aliceToken, origin: uiOrigin, csrf: aliceSession?.csrfToken, ...options });
  const verifier = 'm'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizePath = (overrides = {}) => '/oauth/authorize?' + new URLSearchParams({ client_id: clientId, redirect_uri: callbackUri,
    response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource: apiOrigin + '/mcp',
    scope: 'relay:read relay:send offline_access', state: 'migration-state', ...overrides });

  await check('trusted UI preflights are anonymous and allow dashboard headers and methods', async () => {
    const before = sqlite.prepare('SELECT count(*) AS n FROM users').get().n;
    for (const [path, method] of [['/auth/config', 'GET'], ['/auth/session', 'GET'], ['/auth/clerk/session', 'POST'],
      ['/auth/logout', 'POST'], ['/oauth/authorize', 'POST'], ['/v1/admin/agents', 'POST'], ['/v1/admin/workspace', 'PATCH'], ['/v1/admin/workspace', 'DELETE']]) {
      const result = await req(path, { method: 'OPTIONS', origin: uiOrigin, headers: {
        'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type,x-csrf-token,idempotency-key' } });
      assert.ok(result.status >= 200 && result.status < 300); allowedCors(result);
      assert.ok((result.headers.get('access-control-allow-methods') ?? '').split(/,\s*/).includes(method));
      const allow = (result.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(/,\s*/);
      for (const header of ['authorization', 'content-type', 'x-csrf-token', 'idempotency-key']) assert.ok(allow.includes(header));
    }
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM users').get().n, before);
    assert.equal(providerCalls, 0);
  });
  await check('foreign, null, missing and lookalike browser origins never receive CORS permission', async () => {
    for (const origin of [undefined, 'null', 'https://evil.example.test', uiOrigin + '.attacker.test', uiOrigin + ':8443', uiOrigin.replace('https:', 'http:')]) {
      const result = await req('/auth/config', { method: 'OPTIONS', origin, headers: { 'access-control-request-method': 'POST' } });
      assert.equal(result.headers.get('access-control-allow-origin'), null);
    }
  });
  await check('API config and discovery advertise separate UI, API and Clerk origins', async () => {
    const config = await req('/auth/config', { origin: uiOrigin });
    assert.equal(config.status, 200); allowedCors(config);
    assert.equal(config.data.apiOrigin, apiOrigin); assert.equal(config.data.frontendOrigin, uiOrigin);
    assert.equal(config.data.frontendApi, issuer);
    assert.equal(new URL(config.data.loginUrl, apiOrigin).origin, uiOrigin);
    const discovery = await req('/.well-known/oauth-authorization-server');
    assert.equal(discovery.data.issuer, apiOrigin);
    assert.equal(discovery.data.authorization_endpoint, apiOrigin + '/oauth/authorize');
    assert.equal(discovery.data.token_endpoint, apiOrigin + '/oauth/token');
    const protectedResource = await req('/.well-known/oauth-protected-resource/mcp');
    assert.equal(protectedResource.data.resource, apiOrigin + '/mcp');
    assert.deepEqual(protectedResource.data.authorization_servers, [apiOrigin]);
    const deniedMcp = await req('/mcp');
    assert.equal(deniedMcp.status, 401);
    assert.match(deniedMcp.headers.get('www-authenticate'), /api\.migration\.example\.test/);
  });
  await check('frontend-issued Clerk sessions bootstrap on API and retain CSRF across refresh', async () => {
    const a = await req('/auth/clerk/session', { method: 'POST', origin: uiOrigin, token: aliceToken, body: {} });
    assert.equal(a.status, 200); allowedCors(a); assert.equal(a.data.authenticated, true); aliceSession = a.data;
    const b = await req('/auth/clerk/session', { method: 'POST', origin: uiOrigin, token: bobToken, body: {} });
    assert.equal(b.status, 200); bobSession = b.data;
    const refreshed = await req('/auth/session', { token: tokenFor(alice, { jti: 'refreshed' }), origin: uiOrigin });
    assert.equal(refreshed.data.user.id, aliceSession.user.id);
    assert.equal(refreshed.data.workspace.id, aliceSession.workspace.id);
    assert.equal(refreshed.data.csrfToken, aliceSession.csrfToken);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM users').get().n, 2);
    const cookieOnly = await req('/auth/session', { origin: uiOrigin, headers: { cookie: '__session=' + aliceToken } });
    assert.equal(cookieOnly.data.authenticated, false, 'Split API requires explicit bearer even when a parent-domain cookie exists');
  });
  await check('wrong Clerk audience or issuer and noncanonical API hosts stay unauthenticated', async () => {
    for (const claims of [{ azp: 'https://evil.example.test' }, { azp: uiOrigin + ':8443' }, { azp: undefined }, { iss: issuer + '/' }]) {
      const result = await req('/auth/session', { token: tokenFor(alice, claims), origin: uiOrigin });
      assert.ok(result.status >= 400 || result.data?.authenticated === false);
    }
    for (const host of [uiOrigin, 'https://api.migration.example.test.attacker.test', apiOrigin + ':8443']) {
      denied(await req('/v1/admin/overview', { host, token: aliceToken, origin: uiOrigin }));
    }
  });
  await check('trusted browser writes still reject absent, wrong and other-session CSRF', async () => {
    for (const csrf of [undefined, 'invalid', bobSession.csrfToken]) {
      const result = await owner('/v1/admin/workspace', { method: 'PATCH', csrf, body: { name: 'Must not change' } });
      assert.equal(result.status, 403); allowedCors(result);
    }
    for (const origin of [undefined, 'null', 'https://evil.example.test', uiOrigin + ':8443']) {
      assert.equal((await owner('/v1/admin/workspace', { method: 'PATCH', origin, body: { name: 'Must not change' } })).status, 403);
    }
    const changed = await owner('/v1/admin/workspace', { method: 'PATCH', body: { name: 'Migration fixture' } });
    assert.equal(changed.status, 200); allowedCors(changed);
    const missing = await req('/v1/admin/overview', { origin: uiOrigin });
    assert.equal(missing.status, 401); allowedCors(missing);
  });
  await check('body-limit and rate-limit failures remain readable by the trusted UI', async () => {
    const limited = await owner('/v1/admin/overview', { settings: { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } } });
    assert.equal(limited.status, 429); allowedCors(limited);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.match(limited.headers.get('access-control-expose-headers') ?? '', /Retry-After/i);
    const oversized = await owner('/v1/admin/workspace', { method: 'PATCH', body: { name: 'x'.repeat(513 * 1024) } });
    assert.equal(oversized.status, 413); allowedCors(oversized);
  });
  await check('connection setup and single-use worker pairing use canonical API URLs', async () => {
    const create = async (id, platform) => {
      const result = await owner('/v1/admin/agents', { method: 'POST', body: { id, name: id, platform,
        can_request: true, can_work: true, work_types: ['task'], accept_from: ['*'], request_targets: ['*'] } });
      assert.equal(result.status, 201); allowedCors(result); assert.equal(result.data.token, undefined); return result.data;
    };
    const senderData = await create('migration-sender', 'codex'); sender = senderData.agent;
    assert.ok(JSON.stringify(senderData.guide).includes(apiOrigin + '/mcp'));
    const receiverData = await create('migration-worker', 'muse'); receiver = receiverData.agent;
    assert.ok(JSON.stringify(receiverData.guide).includes(apiOrigin + '/v1/pair'));
    const pairing = await owner(`/v1/admin/agents/${receiver.id}/pairing`, { method: 'POST', body: {} });
    assert.equal(pairing.status, 200); assert.ok(pairing.data.instructions.includes(apiOrigin + '/v1/pair'));
    const paired = await req('/v1/pair', { method: 'POST', body: { code: pairing.data.code } });
    assert.equal(paired.status, 200); receiverToken = paired.data.token;
    assert.equal(paired.data.relay_url, apiOrigin); assert.ok(paired.data.instructions.includes(apiOrigin + '/v1/work/next'));
    denied(await req('/v1/pair', { method: 'POST', body: { code: pairing.data.code } }));
    const foreign = await req(`/v1/admin/agents/${receiver.id}/setup`, { token: bobToken, origin: uiOrigin });
    assert.equal(foreign.status, 404); allowedCors(foreign);
    assert.equal((await req('/w/synthetic-claim')).status, 404);
  });
  await check('signed-out consent moves to frontend with only allowlisted authorization state', async () => {
    const registration = await req('/oauth/register', { method: 'POST', body: { client_name: 'Migration fixture', redirect_uris: [callbackUri], token_endpoint_auth_method: 'none' } });
    assert.equal(registration.status, 201); clientId = registration.data.client_id;
    const result = await req(authorizePath() + '&__clerk_handshake=discard-me', { headers: { accept: 'text/html' } });
    assert.ok([302, 303, 307].includes(result.status));
    const destination = new URL(result.headers.get('location'), apiOrigin);
    assert.equal(destination.origin, uiOrigin); assert.ok(['/sign-in', '/connect'].includes(destination.pathname));
    assert.ok(destination.href.includes(clientId)); assert.ok(!destination.href.includes('discard-me'));
  });
  await check('JSON consent rejects foreign resource and returns readable errors', async () => {
    for (const resource of [uiOrigin + '/mcp', 'https://evil.example.test/mcp', apiOrigin + '/mcp/']) {
      const result = await owner(authorizePath({ resource }));
      assert.equal(result.status, 400); allowedCors(result);
      assert.equal(result.data?.error?.code, 'invalid_target');
    }
  });
  await check('consent binds tenant and CSRF, preserves refreshed session, then issues one callback', async () => {
    const consent = await owner(authorizePath());
    assert.equal(consent.status, 200); allowedCors(consent);
    assert.equal(consent.data.clientName, 'Migration fixture'); assert.equal(consent.data.redirectOrigin, new URL(callbackUri).origin);
    assert.ok(consent.data.agents.some(a => a.id === sender.id)); assert.equal(consent.data.csrfToken, aliceSession.csrfToken);
    const form = { request_id: consent.data.requestId, csrf_token: consent.data.csrfToken, decision: 'allow', agent_id: sender.id };
    for (const change of [{ origin: 'https://evil.example.test' }, { form: { ...form, csrf_token: bobSession.csrfToken } }, { token: bobToken, csrf: bobSession.csrfToken, form: { ...form, csrf_token: bobSession.csrfToken } }]) {
      denied(await owner('/oauth/authorize', { method: 'POST', form, ...change }));
    }
    const approved = await owner('/oauth/authorize', { method: 'POST', token: tokenFor(alice, { jti: 'consent-refresh' }), form });
    assert.equal(approved.status, 200); allowedCors(approved);
    const callback = new URL(approved.data.redirectUrl);
    assert.equal(callback.origin + callback.pathname, callbackUri); assert.equal(callback.searchParams.get('iss'), apiOrigin);
    assert.equal(callback.searchParams.get('state'), 'migration-state'); assert.ok(callback.searchParams.get('code'));
    assert.equal(approved.headers.get('location'), null, 'Fetch must receive JSON rather than follow the client callback');
    denied(await owner('/oauth/authorize', { method: 'POST', form }));
    const exchange = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: callbackUri,
      code: callback.searchParams.get('code'), code_verifier: verifier, resource: apiOrigin + '/mcp' };
    assert.equal((await req('/oauth/token', { method: 'POST', form: { ...exchange, resource: uiOrigin + '/mcp' } })).status, 400);
    const tokens = await req('/oauth/token', { method: 'POST', form: exchange });
    assert.equal(tokens.status, 200); native = tokens.data; assert.ok(native.access_token && native.refresh_token);
  });
  await check('OAuth requester sends a job, paired HTTP worker completes it, UI and MCP read the result', async () => {
    const created = await req('/v1/jobs', { method: 'POST', token: native.access_token, headers: { 'idempotency-key': 'migration-roundtrip' },
      body: { type: 'task', to: receiver.id, title: 'Isolated migration test', goal: 'Return the synthetic acknowledgement. Do not contact any service.' } });
    assert.equal(created.status, 201); const id = created.data.job.id;
    const claim = await req('/v1/work/next?format=json', { method: 'POST', token: receiverToken });
    assert.equal(claim.status, 200); assert.equal(claim.data.job.id, id);
    assert.equal(claim.data.submit_url, apiOrigin + '/v1/submit'); assert.equal(claim.data.form_url, undefined);
    const result = await req('/v1/submit', { method: 'POST', token: receiverToken, headers: { 'x-claim-token': claim.data.claim_id },
      body: { summary: 'Synthetic migration complete', body: 'Only isolated local fixture data was used.' } });
    assert.equal(result.status, 200);
    const ui = await owner('/v1/jobs/' + id); assert.equal(ui.status, 200); allowedCors(ui);
    assert.equal(ui.data.job.status, 'completed'); assert.equal(ui.data.job.result.summary, 'Synthetic migration complete');
    const mcp = await req('/mcp', { method: 'POST', token: native.access_token, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_job', arguments: { job_id: id } } } });
    assert.equal(mcp.status, 200); assert.ok(JSON.stringify(mcp.data.result).includes('Synthetic migration complete'));
    assert.equal((await req('/v1/admin/overview', { token: native.access_token })).status, 403);
  });
  await check('refresh rejects old frontend resource without consuming valid API refresh', async () => {
    const form = { grant_type: 'refresh_token', client_id: clientId, refresh_token: native.refresh_token, resource: apiOrigin + '/mcp' };
    assert.equal((await req('/oauth/token', { method: 'POST', form: { ...form, resource: uiOrigin + '/mcp' } })).status, 400);
    const renewed = await req('/oauth/token', { method: 'POST', form });
    assert.equal(renewed.status, 200); assert.ok(renewed.data.access_token);
  });
  await check('consent denial returns exact callback and consumes the consent request', async () => {
    const consent = await owner(authorizePath()); assert.equal(consent.status, 200);
    const form = { request_id: consent.data.requestId, csrf_token: consent.data.csrfToken, decision: 'deny' };
    const result = await owner('/oauth/authorize', { method: 'POST', form }); assert.equal(result.status, 200);
    const callback = new URL(result.data.redirectUrl); assert.equal(callback.origin + callback.pathname, callbackUri);
    assert.equal(callback.searchParams.get('error'), 'access_denied'); assert.equal(callback.searchParams.get('state'), 'migration-state');
    denied(await owner('/oauth/authorize', { method: 'POST', form }));
  });
  await check('split browser logout remains CSRF protected and invalidates the Clerk session', async () => {
    assert.equal((await owner('/auth/logout', { method: 'POST', csrf: undefined, body: {} })).status, 403);
    const result = await owner('/auth/logout', { method: 'POST', body: {} }); assert.equal(result.status, 200); allowedCors(result);
    const signedOut = await owner('/auth/session'); assert.equal(signedOut.data.authenticated, false);
    assert.equal((await owner('/v1/admin/overview')).status, 401);
  });
  console.log(`\n${checks} split-origin integration checks passed; all provider traffic was mocked.`);
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
  await rm(temporary, { recursive: true, force: true });
}
