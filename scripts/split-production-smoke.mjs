#!/usr/bin/env node
/** Credential-free checks of the split deployment. No account, task, pairing,
 * OAuth client, or consent is created. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const frontend = process.env.HITCHHIKE_FRONTEND_URL || 'https://hitchhike.dev';
const api = process.env.HITCHHIKE_API_URL || 'https://api.hitchhike.dev';
for (const base of [frontend, api]) {
  const u = new URL(base);
  assert(u.origin === base && u.protocol === 'https:' && !u.username && !u.password, 'Use exact HTTPS origins');
}
let passed = 0, failed = 0;
const observations = [];
async function request(base, path, options = {}) {
  const r = await fetch(base + path, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(15000), ...options });
  const text = await r.text();
  assert(text.length < 1024 * 1024, 'Unexpected response size');
  assert(!/\bsk_(?:live|test)_[A-Za-z0-9]+|\bwhsec_[A-Za-z0-9+/=]+|BEGIN (?:RSA )?PRIVATE KEY/.test(text), 'Server credential material in response');
  let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, headers: r.headers, text, json };
}
async function check(name, action) {
  try { await action(); passed++; console.log('ok - ' + name); observations.push({ name, passed: true }); }
  catch (e) { failed++; console.error('FAIL - ' + name + ': ' + e.message); observations.push({ name, passed: false, error: e.message }); }
}
function noStore(r) { assert.match(r.headers.get('cache-control') || '', /no-store/); }
function anonymous(r, status = 401) {
  assert.equal(r.status, status);
  assert(!r.headers.has('set-cookie'));
  assert(!r.json?.user && !r.json?.workspace && !r.json?.csrfToken);
}
let home;
for (const path of ['/', '/app', '/sign-in', '/connect', '/privacy', '/terms']) {
  await check('Vercel page ' + path + ' and script policy', async () => {
    const r = await request(frontend, path);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/html/);
    assert.match(r.text, /Hitchhike|hitchhike/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const csp = r.headers.get('content-security-policy') || '';
    assert(csp.includes("frame-ancestors 'none'"));
    assert(!/nonce=/.test(r.text));
    for (const m of r.text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      assert(csp.includes("'sha256-" + createHash('sha256').update(m[1]).digest('base64') + "'"), 'Inline script CSP hash mismatch');
    }
    if (['/app','/sign-in','/connect'].includes(path)) {
      noStore(r);
      assert(r.text.includes(api), 'Browser page must point at API origin');
      assert.match(r.headers.get('x-robots-tag') || r.text, /noindex/);
    }
    if (path === '/') { home = r; noStore(r); assert(r.text.includes('href="/sign-in"')); }
  });
}
await check('content-hashed landing assets remain immutable', async () => {
  assert(home);
  const paths = [...new Set([...home.text.matchAll(/(?:src|href)="(\/_hitchhike-assets\/[^"?#]+)"/g)].map(m => m[1]))];
  assert(paths.length >= 4, 'Missing content-hashed asset references');
  for (const path of paths) {
    assert.match(path, /\.[a-f0-9]{16}\.(?:css|js|png|svg)$/);
    const r = await fetch(frontend + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control') || '', /max-age=31536000.*immutable/);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert(path.includes('.' + createHash('sha256').update(bytes).digest('hex').slice(0,16) + '.'), 'Asset hash does not match its bytes');
  }
});
await check('API health reports the stamped release and Worker version', async () => {
  // Fails against a Worker deployed without --var HITCHHIKE_RELEASE:"$(git rev-parse --short=12 HEAD)".
  const r = await request(api, '/healthz'); assert.equal(r.status, 200);
  assert.equal(r.json.ok, true); assert.equal(r.json.protocol, '0.1');
  assert.deepEqual(Object.keys(r.json).sort(), ['ok', 'protocol', 'release', 'version']);
  assert(typeof r.json.release === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(r.json.release), 'Hosted release must be stamped at deploy time');
  assert(typeof r.json.version === 'string' && r.json.version.length > 0, 'Worker version metadata binding is missing');
});
await check('API root points to frontend workspace', async () => {
  const r = await request(api, '/'); assert.equal(r.status, 303); assert.equal(r.headers.get('location'), frontend + '/app');
});
await check('public auth config uses original Clerk and separate origins', async () => {
  const r = await request(api, '/auth/config', { headers: { Origin: frontend } });
  assert.equal(r.status, 200); noStore(r);
  assert.equal(r.headers.get('access-control-allow-origin'), frontend);
  assert.equal(r.json.apiOrigin, api); assert.equal(r.json.frontendOrigin, frontend);
  assert.equal(r.json.loginUrl, frontend + '/sign-in');
  assert.equal(r.json.authProvider, 'clerk'); assert.equal(r.json.loginConfigured, true);
  assert.equal(r.json.frontendApi, 'https://clerk.hitchhike.dev');
  assert.match(r.json.publishableKey, /^pk_live_/);
  assert.equal(Buffer.from(r.json.publishableKey.slice(8), 'base64').toString(), 'clerk.hitchhike.dev$');
});
await check('anonymous session and API remain private', async () => {
  const session = await request(api, '/auth/session', { headers: { Origin: frontend } });
  assert.equal(session.status, 200); assert.equal(session.json.authenticated, false); noStore(session);
  assert.equal(session.headers.get('access-control-allow-origin'), frontend);
  for (const path of ['/v1/admin/overview','/v1/admin/workspace','/v1/jobs','/v1/events']) {
    const r = await request(api, path, { headers: { Origin: frontend } }); anonymous(r); noStore(r);
    assert.equal(r.headers.get('access-control-allow-origin'), frontend, 'CORS must also cover API errors');
  }
});
await check('frontend preflight allowed without cookie credentials', async () => {
  const r = await request(api, '/v1/admin/agents', { method: 'OPTIONS', headers: { Origin: frontend, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-csrf-token,idempotency-key' } });
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), frontend);
  assert(!r.headers.has('access-control-allow-credentials'));
});
await check('untrusted browser origin and headers rejected', async () => {
  for (const path of ['/auth/config','/v1/admin/overview']) {
    const r = await request(api, path, { headers: { Origin: 'https://untrusted.example' } });
    assert.equal(r.status, 403); assert(!r.headers.has('access-control-allow-origin'));
  }
  const r = await request(api, '/v1/admin/agents', { method: 'OPTIONS', headers: { Origin: frontend, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-unexpected-header' } });
  assert.equal(r.status, 403);
});
await check('agent OAuth advertises API issuer and resource', async () => {
  const r = await request(api, '/.well-known/oauth-authorization-server'); assert.equal(r.status, 200);
  assert.equal(r.json.issuer, api);
  for (const [key,path] of Object.entries({ authorization_endpoint: '/oauth/authorize', token_endpoint: '/oauth/token', registration_endpoint: '/oauth/register', revocation_endpoint: '/oauth/revoke' })) assert.equal(r.json[key], api + path);
  assert.deepEqual(r.json.code_challenge_methods_supported, ['S256']);
  const resource = await request(api, '/.well-known/oauth-protected-resource/mcp');
  assert.equal(resource.status, 200); assert.equal(resource.json.resource, api + '/mcp'); assert.deepEqual(resource.json.authorization_servers, [api]);
  const mcp = await request(api, '/mcp'); anonymous(mcp);
  assert.equal(mcp.headers.get('www-authenticate'), `Bearer resource_metadata="${api}/.well-known/oauth-protected-resource/mcp"`);
});
await check('server webhook still requires signatures and dev login stays off', async () => {
  const r = await request(api, '/auth/clerk/webhook', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ type: 'smoke.noop', data: {} }) });
  anonymous(r, 400); assert.equal(r.json.error, 'invalid_webhook');
  anonymous(await request(api, '/auth/dev'), 404);
});
console.log(`Split production smoke: ${passed} passed, ${failed} failed; no authenticated user data accessed or mutated`);
if (process.env.HITCHHIKE_SMOKE_REPORT) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(process.env.HITCHHIKE_SMOKE_REPORT, JSON.stringify({ time:new Date().toISOString(),frontend,api,passed,failed,observations },null,2)+'\n');
}
if (failed) process.exitCode = 1;
