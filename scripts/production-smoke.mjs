#!/usr/bin/env node
/** Public, credential-free release checks. No signup, OAuth registration, tasks,
 * pairing, or owner mutations. The two POST bodies cannot identify any user:
 * an unsigned unknown webhook event and an empty disabled-dev-login request. */
import { pathToFileURL } from 'node:url';

export async function productionSmoke({ origin = 'https://hitchhike.dev', clerkIssuer = process.env.EXPECTED_CLERK_ISSUER,
  requireIndexing = false, send = fetch, log = console.log } = {}) {
  const target = new URL(origin);
  if (target.origin !== origin || target.protocol !== 'https:' || target.username || target.password) {
    throw new Error('Smoke target must be an exact HTTPS origin without a path, query, or credentials.');
  }
  let passed = 0, failed = 0;
  const warnings = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  async function check(name, work) {
    try { await work(); passed++; log(`ok ${passed + failed} - ${name}`); }
    catch (error) { failed++; log(`FAIL ${passed + failed} - ${name}: ${error.message}`); }
  }
  async function request(path, { method = 'GET', body } = {}) {
    // Fixed relative paths, no cookies, credentials, redirect following or retry.
    const response = await send(origin + path, { method, redirect: 'manual', credentials: 'omit',
      headers: { accept: 'application/json, text/html;q=0.9', ...(body === undefined ? {} : { 'content-type': 'application/json', origin }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    assert(text.length < 1024 * 1024, 'Unexpectedly large public response');
    assert(!/\bsk_(?:live|test)_[A-Za-z0-9]+|\bwhsec_[A-Za-z0-9+/=]+|BEGIN (?:RSA )?PRIVATE KEY/.test(text), 'Response contains server credential material');
    assert(response.headers.get('x-content-type-options') === 'nosniff', 'Missing nosniff response header');
    assert(response.headers.get('x-frame-options') === 'DENY', 'Missing frame denial response header');
    let data; try { data = JSON.parse(text); } catch { /* HTML is expected on public pages. */ }
    return { status: response.status, headers: response.headers, text, data };
  }
  function denied(response, status = 401) {
    assert(response.status === status, `Expected HTTP ${status}, received ${response.status}`);
    assert(!response.headers.has('set-cookie'), 'Anonymous denial must not create a browser session');
    assert(!response.data?.user && !response.data?.workspace && !response.data?.csrfToken, 'Anonymous response contains account data');
  }
  function publicSeo(response, path) {
    const noindex = /\bnoindex\b/i.test(response.headers.get('x-robots-tag') || '') || /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(response.text);
    const canonical = response.text.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
    const issues = [...(noindex ? ['still has noindex'] : []), ...(canonical !== origin + path ? ['has no exact canonical URL'] : [])];
    if (requireIndexing) assert(issues.length === 0, `${path} ${issues.join(' and ')}`);
    else if (issues.length) warnings.push(`${path} ${issues.join(' and ')}`);
  }

  log(`Credential-free production smoke checks: ${origin}`);
  await check('public homepage serves Hitchhike branding and configured hosted sign-in', async () => {
    const r = await request('/');
    assert(r.status === 200 && /text\/html/.test(r.headers.get('content-type') || ''), 'Homepage must return HTML200');
    assert(/<title>[^<]*Hitchhike[^<]*<\/title>/i.test(r.text), 'Homepage title is missing Hitchhike');
    assert(/Connect your AI apps/i.test(r.text), 'Homepage product explanation is missing');
    assert(/data-hosted="true"/.test(r.text) && /data-auth-configured="true"/.test(r.text), 'Hosted sign-in is not configured');
    assert(r.text.includes('href="/privacy"') && r.text.includes('href="/auth/start"'), 'Public sign-in or privacy link is missing');
    assert(r.headers.has('content-security-policy'), 'Clerk homepage needs its content security policy');
    publicSeo(r, '/');
  });
  await check('health exposes only the expected service health contract', async () => {
    const r = await request('/healthz');
    assert(r.status === 200 && r.data?.ok === true && r.data?.protocol === '0.1', 'Unexpected health response');
    for (const key of ['release', 'version']) assert(typeof r.data[key] === 'string' || r.data[key] === null, `Health ${key} must be a string or null`);
  });
  await check('privacy page is public and describes account, task, and deletion handling', async () => {
    const r = await request('/privacy');
    assert(r.status === 200 && /Privacy and data[^<]*Hitchhike/.test(r.text), 'Privacy page is missing or unbranded');
    for (const phrase of ['Cloudflare', 'Clerk', 'Task', 'deletion']) assert(r.text.includes(phrase), `Privacy page is missing ${phrase}`);
    publicSeo(r, '/privacy');
  });
  await check('public authentication config uses a configured production Clerk instance', async () => {
    const r = await request('/auth/config'), c = r.data;
    assert(r.status === 200 && c?.authProvider === 'clerk' && c?.loginConfigured === true, 'Clerk authentication is not configured');
    assert(c.loginUrl === '/auth/start' && /^pk_live_/.test(c.publishableKey || ''), 'Production must expose a live publishable key and local login entry');
    const frontend = new URL(c.frontendApi);
    assert(frontend.protocol === 'https:' && frontend.origin === c.frontendApi && !frontend.username && !frontend.password, 'Invalid Clerk issuer origin');
    assert(Buffer.from(c.publishableKey.slice('pk_live_'.length), 'base64').toString() === frontend.hostname + '$', 'Publishable key is bound to a different Clerk instance');
    if (clerkIssuer) assert(c.frontendApi === clerkIssuer, 'Clerk issuer differs from EXPECTED_CLERK_ISSUER');
    assert(Object.keys(c).every((key) => ['authProvider', 'loginConfigured', 'loginUrl', 'publishableKey', 'frontendApi'].includes(key)), 'Public auth config exposes unexpected fields');
    assert(/no-store/.test(r.headers.get('cache-control') || ''), 'Auth configuration must not be cached');
  });
  await check('anonymous session has no account data or authentication cookie', async () => {
    const r = await request('/auth/session');
    assert(r.status === 200 && r.data?.authenticated === false, 'Anonymous session must be signed out');
    assert(!r.data.user && !r.data.workspace && !r.data.csrfToken && !r.headers.has('set-cookie'), 'Anonymous session created or exposed account data');
  });
  await check('sign-in entry redirects only to the local Clerk page', async () => {
    const r = await request('/auth/start'), location = r.headers.get('location');
    assert([302, 303].includes(r.status) && location, 'Sign-in entry must redirect');
    const redirect = new URL(location, origin);
    assert(redirect.origin === origin && redirect.pathname === '/auth/clerk/start' && redirect.searchParams.get('return_to') === '/', 'Sign-in redirect leaves the intended local flow');
  });
  await check('OAuth server discovery advertises the exact production issuer and endpoints', async () => {
    const r = await request('/.well-known/oauth-authorization-server'), c = r.data;
    assert(r.status === 200 && c?.issuer === origin, 'OAuth issuer must exactly match the production origin');
    for (const [key, path] of Object.entries({ authorization_endpoint: '/oauth/authorize', token_endpoint: '/oauth/token', registration_endpoint: '/oauth/register', revocation_endpoint: '/oauth/revoke' })) {
      assert(c[key] === origin + path, `Incorrect ${key}`);
    }
    assert(JSON.stringify(c.code_challenge_methods_supported) === '["S256"]', 'OAuth must require S256 PKCE');
    assert(c.authorization_response_iss_parameter_supported === true && c.grant_types_supported?.includes('refresh_token'), 'OAuth issuer binding or refresh support missing');
  });
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    await check(`OAuth resource discovery is correct at ${path}`, async () => {
      const r = await request(path), c = r.data;
      assert(r.status === 200 && c?.resource === origin + '/mcp', 'OAuth resource is not the exact production MCP URL');
      assert(JSON.stringify(c.authorization_servers) === JSON.stringify([origin]), 'OAuth resource trusts an unexpected issuer');
      assert(JSON.stringify(c.bearer_methods_supported) === '["header"]', 'OAuth must advertise header-only credentials');
      for (const scope of ['relay:read', 'relay:send', 'relay:work']) assert(c.scopes_supported?.includes(scope), `Missing ${scope} scope`);
    });
  }
  for (const path of ['/v1/admin/overview', '/v1/admin/workspace', '/v1/jobs', '/v1/events', '/v1/work/next']) {
    await check(`anonymous access denied at ${path}`, async () => {
      const r = await request(path); denied(r);
      assert(/no-store/.test(r.headers.get('cache-control') || ''), 'Protected API denial must not be cached');
      assert(/noindex/.test(r.headers.get('x-robots-tag') || ''), 'Protected API must remain non-indexable');
    });
  }
  await check('MCP rejects anonymous access and returns exact resource discovery challenge', async () => {
    const r = await request('/mcp'); denied(r);
    assert(r.headers.get('www-authenticate') === `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`, 'MCP challenge has incorrect resource metadata');
  });
  await check('hosted URL credentials are denied before authentication', async () => {
    const r = await request('/mcp?key=smoke-invalid-public-placeholder'); denied(r);
    assert(r.data?.error?.code === 'url_credentials_disabled', 'URL credentials were not rejected by the hosted guard');
  });
  await check('unsigned Clerk webhook is rejected without identifying an account', async () => {
    const r = await request('/auth/clerk/webhook', { method: 'POST', body: { type: 'smoke.noop', data: {} } }); denied(r, 400);
    assert(r.data?.error === 'invalid_webhook', 'Webhook signing is absent or unsigned events are not rejected');
  });
  await check('production development login is disabled for both page and submission', async () => {
    denied(await request('/auth/dev'), 404);
    denied(await request('/auth/dev', { method: 'POST', body: {} }), 404);
  });
  for (const warning of warnings) log(`SEO note: ${warning}`);
  log(`\nProduction smoke: ${passed} passed, ${failed} failed. No authenticated or user-data mutations were requested.`);
  return { passed, failed, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/production-smoke.mjs [https://hitchhike.dev] [--require-indexing]\nOptional EXPECTED_CLERK_ISSUER pins the exact public Clerk instance. No credentials are accepted.');
  } else {
    const origins = args.filter((arg) => !arg.startsWith('--'));
    if (origins.length > 1 || args.some((arg) => arg.startsWith('--') && arg !== '--require-indexing')) throw new Error('Use --help for usage.');
    const result = await productionSmoke({ origin: origins[0], requireIndexing: args.includes('--require-indexing') });
    if (result.failed) process.exitCode = 1;
  }
}
