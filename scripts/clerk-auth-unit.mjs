/** Clerk authentication regressions: real SDK signature verification, generated
 * RSA keys, migrated in-memory SQLite, and mocked fixed Clerk API endpoints.
 * No external service, production key, or authentication bypass is used. */
import assert from "node:assert/strict";
import { createHash, createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "relay-clerk-auth-test-"));
const sqlite = new DatabaseSync(":memory:");
const originalFetch = globalThis.fetch;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const base = "https://relay.example.test";
const issuer = "https://relay-test.clerk.accounts.dev";
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
const webhookKey = Buffer.from("synthetic-clerk-webhook-test-secret");
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
let passed = 0;
let serial = 0;
const profiles = new Map();
const providerSessions = new Map();
const providerCalls = [];
const revokedSessions = new Set();
const deletedUsers = new Set();
let providerFailure = null;

class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() { return { meta: sqlite.prepare(this.sql).run(...this.values), success: true }; }
}
const DB = {
  prepare: (sql) => new Statement(sql),
  async batch(statements) {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
const env = {
  DB,
  HOSTED: "true",
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  GLOBAL_RATE_LIMITER: { limit: async () => ({ success: true }) },
  ENCRYPTION_KEY: "synthetic-clerk-encryption-fixture-only",
  AUTH_PROVIDER: "clerk",
  SIGNUP_MODE: "public",
  PUBLIC_URL: base,
  CLERK_PUBLISHABLE_KEY: "pk_test_" + Buffer.from(new URL(issuer).hostname + "$").toString("base64"),
  CLERK_SECRET_KEY: "sk_test_synthetic_fixture_only",
  CLERK_ISSUER: issuer,
  CLERK_JWT_KEY: publicKeyPem,
  CLERK_ALLOW_DEVELOPMENT: "true",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_" + webhookKey.toString("base64"),
};
const request = (path, options = {}) => new Request(base + path, options);
const form = (body, headers = {}) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body) });
const count = (table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const check = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };

function tokenFor(identity, overrides = {}, header = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, azp: base, sub: identity.sub, sid: identity.sid, iat: now, nbf: now - 1, exp: now + 60, v: 2, fva: [0, -1], sts: "active", ...overrides };
  for (const field of Object.keys(claims)) if (claims[field] === undefined) delete claims[field];
  const unsigned = encode({ alg: "RS256", typ: "JWT", kid: "local-fixture-key", ...header }) + "." + encode(claims);
  return unsigned + "." + createSign("RSA-SHA256").update(unsigned).sign(signingKey, "base64url");
}

function fixture(label, email = `${label}@example.test`, changes = {}) {
  serial++;
  const sub = `user_${label}_${serial}`;
  const sid = `sess_${label}_${serial}`;
  const emailId = `idn_${label}_${serial}`;
  const now = Date.now();
  profiles.set(sub, {
    object: "user", id: sub, username: null, first_name: "Test", last_name: label,
    primary_email_address_id: emailId,
    email_addresses: [{ object: "email_address", id: emailId, email_address: email, verification: { status: "verified", strategy: "email_code" }, linked_to: [] }],
    external_accounts: [], phone_numbers: [], web3_wallets: [], passkeys: [],
    public_metadata: {}, private_metadata: {}, unsafe_metadata: {},
    created_at: now, updated_at: now, banned: false, locked: false,
    ...changes,
  });
  providerSessions.set(sid, { object: "session", id: sid, user_id: sub, status: "active", created_at: now, updated_at: now, expire_at: now + 7 * 86400000, abandon_at: now + 7 * 86400000, last_active_at: now });
  return { sub, sid, email };
}

function signedWebhook(type, data, { timestamp = Math.floor(Date.now() / 1000), invalid = false, id = `msg_local_${++serial}` } = {}) {
  const body = JSON.stringify({ object: "event", type, data, timestamp: timestamp * 1000 });
  const signature = createHmac("sha256", webhookKey).update(`${id}.${timestamp}.${body}`).digest("base64");
  return request("/auth/clerk/webhook", { method: "POST", headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": "v1," + (invalid ? "invalid-signature" : signature) }, body });
}

globalThis.fetch = async (input, options) => {
  const req = input instanceof Request ? input : new Request(input, options);
  const url = new URL(req.url);
  assert.equal(url.origin, "https://api.clerk.com", "Clerk tests must never contact an unexpected origin");
  assert.equal(req.headers.get("authorization"), `Bearer ${env.CLERK_SECRET_KEY}`, "Provider requests use only the configured synthetic secret");
  const path = url.pathname;
  providerCalls.push({ method: req.method, path });
  if (providerFailure === "network") throw new TypeError("Synthetic provider outage");
  if (providerFailure === "unavailable") return Response.json({ errors: [{ code: "service_unavailable", message: "Synthetic provider outage" }] }, { status: 503 });
  if (providerFailure === "invalid_json") return new Response("not JSON", { status: 200, headers: { "content-type": "application/json" } });
  const userId = path.match(/^\/v1\/users\/([^/]+)$/)?.[1];
  if (userId && req.method === "GET") {
    if (!profiles.has(userId) || deletedUsers.has(userId)) return Response.json({ errors: [{ code: "resource_not_found", message: "User missing" }] }, { status: 404 });
    return Response.json(profiles.get(userId));
  }
  if (userId && req.method === "DELETE") {
    deletedUsers.add(userId);
    return Response.json({ object: "user", id: userId, deleted: true });
  }
  const sessionId = path.match(/^\/v1\/sessions\/([^/]+)(?:\/revoke)?$/)?.[1];
  if (sessionId && req.method === "GET") {
    const session = providerSessions.get(sessionId);
    return session ? Response.json({ ...session, status: revokedSessions.has(sessionId) ? "revoked" : session.status }) : Response.json({ errors: [{ code: "resource_not_found" }] }, { status: 404 });
  }
  if (sessionId && path.endsWith("/revoke") && req.method === "POST") {
    revokedSessions.add(sessionId);
    return Response.json({ ...providerSessions.get(sessionId), status: "revoked" });
  }
  throw new Error(`Unexpected mocked Clerk API route: ${req.method} ${path}`);
};

try {
  for (const file of (await readdir(join(root, "migrations"))).filter((file) => file.endsWith(".sql")).sort()) sqlite.exec(await readFile(join(root, "migrations", file), "utf8"));
  const modulePath = join(temporary, "auth.mjs");
  await build({ stdin: { contents: "export * from './src/auth'; export * from './src/origins'; export * from './src/auth-return'; export {default as relay} from './src/index';", resolveDir: root }, bundle: true, platform: "node", format: "esm", outfile: modulePath, logLevel: "silent" });
  const auth = await import(pathToFileURL(modulePath).href);
  const handle = (req, settings = env) => auth.handleAuth(req, settings);
  async function route(req, settings = env) {
    const background = [];
    const response = await auth.relay.fetch(req, settings, { waitUntil: (promise) => background.push(promise), passThroughOnException() {} });
    for (const result of await Promise.allSettled(background)) assert.equal(result.status, "fulfilled", "Background HTTP work succeeds");
    return response;
  }
  const sessionRequest = (token, cookie = false) => request("/auth/session", { headers: cookie ? { cookie: `__session=${token}` } : { authorization: `Bearer ${token}` } });
  async function session(identity, { claims = {}, cookie = false, settings = env } = {}) {
    const token = tokenFor(identity, claims);
    const response = await handle(sessionRequest(token, cookie), settings);
    assert.equal(response.status, 200, "Valid Clerk session must be accepted");
    const data = await response.json();
    assert.equal(data.authenticated, true, "Valid Clerk identity must authenticate");
    assert.ok(data.csrfToken, "Clerk session must have native CSRF protection");
    return { ...data, token, identity };
  }
  async function rejectedToken(token, settings = env) {
    const usersBefore = count("users");
    const response = await handle(sessionRequest(token), settings);
    const data = await response.json();
    assert.ok(response.status >= 400 || data.authenticated === false, "Rejected token must not authenticate");
    assert.equal(count("users"), usersBefore, "Rejected token cannot create an account");
    return { response, data };
  }

  await check("Clerk configuration requires an explicit trusted issuer and matching frontend", async () => {
    const identity = fixture("config");
    for (const changes of [{ CLERK_ISSUER: undefined }, { CLERK_SECRET_KEY: undefined }, { CLERK_PUBLISHABLE_KEY: undefined }, { CLERK_ISSUER: "http://relay-test.clerk.accounts.dev" }, { CLERK_ALLOW_DEVELOPMENT: undefined }, { FRONTEND_URL: "http://localhost:4173", CLERK_ALLOW_DEVELOPMENT: undefined }]) {
      await rejectedToken(tokenFor(identity), { ...env, ...changes });
    }
  });
  const aliceIdentity = fixture("alice");
  let alice;
  await check("real SDK verifies a signed Clerk session and creates one private workspace", async () => {
    alice = await session(aliceIdentity);
    assert.equal(alice.user.email, aliceIdentity.email);
    assert.ok(alice.workspace.id && alice.user.id);
    assert.ok(providerCalls.some((call) => call.path === `/v1/users/${aliceIdentity.sub}`));
    const rows = sqlite.prepare("SELECT * FROM auth_sessions WHERE user_id=?").all(alice.user.id);
    assert.ok(rows.length > 0, "Native session record exists for CSRF and consent");
    assert.ok(rows.every((row) => !JSON.stringify(row).includes(alice.token)), "Clerk JWT must never persist in the relay database");
  });
  await check("session cookie and bearer tokens resolve the same stable native identity", async () => {
    const cookie = await session(aliceIdentity, { cookie: true });
    assert.equal(cookie.user.id, alice.user.id);
    assert.equal(cookie.workspace.id, alice.workspace.id);
    assert.equal(cookie.csrfToken, alice.csrfToken);
  });
  await check("new hosted workspace rollout requires the explicit enabled default", async () => {
    for (const [value, expected] of [[undefined, 0], ["false", 0], ["true", 1], ["TRUE", 0], ["1", 0]]) {
      const signed = await session(fixture("rollout_default"), { settings: { ...env, NEXT_RELEASE_DEFAULT_ENABLED: value } });
      assert.equal(sqlite.prepare("SELECT next_release_beta FROM workspaces WHERE id=?").get(signed.workspace.id).next_release_beta, expected);
    }
    assert.equal(sqlite.prepare("SELECT next_release_beta FROM workspaces WHERE id='default'").get().next_release_beta, 0, "Hosted signup cannot change the self-hosted default workspace");
  });
  await check("rollout changes and explicit opt-out never overwrite existing workspace choices", async () => {
    const enabled = { ...env, NEXT_RELEASE_DEFAULT_ENABLED: "true" };
    const identity = fixture("rollout_existing"), signed = await session(identity, { settings: enabled });
    const release = workspaceId => sqlite.prepare("SELECT next_release_beta FROM workspaces WHERE id=?").get(workspaceId).next_release_beta;
    for (const settings of [{ ...env, NEXT_RELEASE_DEFAULT_ENABLED: "false" }, env]) {
      sqlite.prepare("UPDATE users SET identity_checked_at=0 WHERE id=?").run(signed.user.id);
      const refreshed = await session(identity, { settings });
      assert.equal(refreshed.workspace.id, signed.workspace.id);
      assert.equal(release(signed.workspace.id), 1, "Rolling back the signup default preserves an existing enabled workspace");
      const afterRollback = await session(fixture("rollout_rollback"), { settings });
      assert.equal(release(afterRollback.workspace.id), 0, "New accounts return to the old default after rollback");
    }
    sqlite.prepare("UPDATE users SET identity_checked_at=0 WHERE id=?").run(alice.user.id);
    assert.equal((await session(aliceIdentity, { settings: enabled })).workspace.id, alice.workspace.id);
    assert.equal(release(alice.workspace.id), 0, "Turning on the signup default cannot promote an existing account");
    const optedOut = await route(request("/v1/workspace/release", { method: "PUT", headers: { authorization: `Bearer ${signed.token}`, origin: base, "x-csrf-token": signed.csrfToken, "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) }), enabled);
    assert.equal(optedOut.status, 200, "The owner can explicitly opt out through the existing API");
    sqlite.prepare("UPDATE users SET identity_checked_at=0 WHERE id=?").run(signed.user.id);
    assert.equal((await session(identity, { settings: enabled })).workspace.id, signed.workspace.id);
    assert.equal(release(signed.workspace.id), 0, "A later login cannot undo the owner's explicit opt-out");
  });
  await check("Clerk session bootstrap accepts only same-origin browser requests", async () => {
    const options = { method: "POST", headers: { authorization: `Bearer ${alice.token}`, "content-type": "application/json" }, body: "{}" };
    assert.equal((await handle(request("/auth/clerk/session", options))).status, 403);
    assert.equal((await handle(request("/auth/clerk/session", { ...options, headers: { ...options.headers, origin: "https://attacker.example.test" } }))).status, 403);
    const sameOrigin = await handle(request("/auth/clerk/session", { ...options, headers: { ...options.headers, origin: base } }));
    assert.equal(sameOrigin.status, 200);
    assert.equal((await sameOrigin.json()).user.id, alice.user.id);
  });
  await check("ambiguous cookies and malformed authorization headers do not select a valid identity", async () => {
    for (const headers of [
      { cookie: `__session=${alice.token}; __session=${alice.token}` },
      { cookie: `__session=${alice.token}`, authorization: "Basic invalid" },
      { cookie: `__session=${alice.token}`, authorization: "Bearer invalid" },
    ]) {
      const response = await handle(request("/auth/session", { headers }));
      const data = await response.json();
      assert.ok(response.status >= 400 || data.authenticated === false);
    }
  });
  await check("bad signatures, malformed tokens, expiry, and future validity are rejected", async () => {
    const identity = fixture("invalid");
    await rejectedToken("not.a.valid.jwt");
    await rejectedToken(tokenFor(identity, {}, {}, wrongKey));
    const now = Math.floor(Date.now() / 1000);
    await rejectedToken(tokenFor(identity, { iat: now - 120, nbf: now - 120, exp: now - 60 }));
    await rejectedToken(tokenFor(identity, { nbf: now + 120, exp: now + 180 }));
  });
  await check("issuer and authorized origin are exact and mandatory", async () => {
    const identity = fixture("claims");
    for (const claims of [{ iss: "https://attacker.clerk.accounts.dev" }, { iss: issuer + "/" }, { iss: undefined }, { azp: "https://attacker.example.test" }, { azp: base + ".attacker.invalid" }, { azp: undefined }]) {
      await rejectedToken(tokenFor(identity, claims));
    }
  });
  await check("split frontend accepts only frontend-minted bearer sessions on the canonical API", async () => {
    const frontend = "https://app.example.test", settings = { ...env, FRONTEND_URL: frontend };
    const identity = fixture("split_identity");
    const signed = await session(identity, { claims: { azp: frontend }, settings });
    for (const azp of [base, frontend + ".attacker.invalid", frontend + "/", frontend + ":8443", "http://app.example.test", undefined]) {
      await rejectedToken(tokenFor(identity, { azp }), settings);
    }
    for (const origin of [frontend, "https://evil.example.test", "https://relay.example.test:8443"]) {
      const response = await route(new Request(origin + "/auth/session", { headers: { authorization: `Bearer ${signed.token}` } }), settings);
      assert.equal(response.status, 400, "Even a frontend-minted session must arrive on the canonical API origin");
    }
    const cookieOnly = await handle(sessionRequest(signed.token, true), settings);
    assert.equal((await cookieOnly.json()).authenticated, false, "Shared parent-domain cookies cannot authenticate the split API");
    const malformedBearer = await handle(request("/auth/session", { headers: { cookie: `__session=${signed.token}`, authorization: "Basic invalid" } }), settings);
    assert.equal((await malformedBearer.json()).authenticated, false);
    const correct = await handle(sessionRequest(signed.token), settings);
    assert.equal((await correct.json()).user.id, signed.user.id);
  });
  await check("split mutation CSRF is session-bound and requires the exact frontend Origin", async () => {
    const frontend = "https://app.example.test", settings = { ...env, FRONTEND_URL: frontend };
    const identity = fixture("split_csrf");
    const signed = await session(identity, { claims: { azp: frontend }, settings });
    const human = await auth.getHumanSession(sessionRequest(signed.token), settings);
    for (const browserOrigin of [undefined, "null", base, frontend + ".evil.invalid", frontend + ":8443", "http://app.example.test"]) {
      const headers = { "X-CSRF-Token": signed.csrfToken, ...(browserOrigin ? { Origin: browserOrigin } : {}) };
      await assert.rejects(auth.requireSessionCsrf(request("/v1/admin/agents", { method: "POST", headers }), human, undefined, settings), error => error.status === 403 && error.code === "csrf_failed");
    }
    await assert.rejects(auth.requireSessionCsrf(request("/v1/admin/agents", { method: "POST", headers: { Origin: frontend, "X-CSRF-Token": alice.csrfToken } }), human, undefined, settings), error => error.status === 403);
    await auth.requireSessionCsrf(request("/v1/admin/agents", { method: "POST", headers: { Origin: frontend, "X-CSRF-Token": signed.csrfToken } }), human, undefined, settings);
  });
  await check("origin configuration accepts explicit origins and rejects unsafe deployment URLs", async () => {
    assert.deepEqual(auth.deploymentOrigins({ PUBLIC_URL: base }), { apiOrigin: base, frontendOrigin: base, split: false });
    assert.deepEqual(auth.deploymentOrigins({ PUBLIC_URL: base + "/", FRONTEND_URL: "http://127.0.0.1:4173" }), { apiOrigin: base, frontendOrigin: "http://127.0.0.1:4173", split: true });
    for (const value of ["https://user:password@app.example.test", "https://app.example.test/path", "https://app.example.test/?key=x", "https://app.example.test/#x", "http://app.example.test", "javascript:alert(1)", "not-a-url"]) {
      assert.throws(() => auth.deploymentOrigins({ PUBLIC_URL: base, FRONTEND_URL: value }), auth.OriginConfigurationError);
      assert.throws(() => auth.deploymentOrigins({ PUBLIC_URL: value }), auth.OriginConfigurationError);
    }
  });
  await check("early origin, configuration, preflight, and size errors retain private response headers", async () => {
    const frontend = "https://app.example.test", settings = { ...env, FRONTEND_URL: frontend };
    const cases = [
      [new Request("https://wrong.example.test/auth/config"), settings, 400],
      [request("/auth/config", { headers: { Origin: "https://evil.example.test" } }), settings, 403],
      [request("/auth/config"), { ...settings, FRONTEND_URL: "https://app.example.test/invalid" }, 503],
      [request("/v1/admin/agents", { method: "OPTIONS", headers: { Origin: frontend, "Access-Control-Request-Method": "TRACE" } }), settings, 403],
      [request("/v1/admin/agents", { method: "POST", headers: { Origin: frontend, "Content-Type": "application/json" }, body: "x".repeat(512 * 1024 + 1) }), settings, 413],
    ];
    for (const [req, bindings, status] of cases) {
      const response = await route(req, bindings);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(response.headers.get("X-Frame-Options"), "DENY");
      assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    }
  });
  await check("frontend return state preserves only app or sanitized consent navigation", async () => {
    const frontend = "https://app.example.test";
    for (const value of [null, "/", "/oauth/authorize?state=x", "/auth/logout", "//evil.example.test/connect", "https://app.example.test.evil.invalid/connect", "/\\evil.example.test/connect", "/connect?state=a&state=b", "https://user:pass@app.example.test/connect"]) {
      assert.equal(auth.safeFrontendReturn(value, frontend), "/app");
    }
    assert.equal(auth.safeFrontendReturn("/app?__clerk_handshake=secret#secret", frontend), "/app");
    const safe = auth.safeFrontendReturn("/connect?client_id=client_1&state=kept&__clerk_handshake=secret&access_token=secret#secret", frontend);
    assert.equal(safe, "/connect?client_id=client_1&state=kept");
    assert.equal(auth.safeAuthReturn("/oauth/authorize?state=kept&__clerk_handshake=secret", base), "/oauth/authorize?state=kept", "Legacy same-origin flow stays compatible");
  });
  await check("a valid Clerk token cannot authenticate requests on an untrusted relay origin", async () => {
    for (const origin of ["https://attacker.example.test", "http://relay.example.test", "https://relay.example.test:8443"]) {
      const response = await route(new Request(origin + "/auth/session", { headers: { authorization: `Bearer ${alice.token}` } }));
      const data = await response.json();
      assert.ok(response.status >= 400 || data.authenticated === false, "The raw request origin must match the configured public origin");
    }
  });
  await check("machine tokens and incomplete session identities cannot become human sessions", async () => {
    const identity = fixture("machine");
    for (const token of ["ak_synthetic_key", "mt_synthetic_token", "oat_synthetic_token", tokenFor(identity, {}, { typ: "at+jwt" }), tokenFor(identity, { sub: "mch_synthetic" }), tokenFor(identity, { sid: undefined }), tokenFor(identity, { sub: undefined }), tokenFor(identity, { sts: "pending" })]) {
      await rejectedToken(token);
    }
  });
  await check("only the provider's verified primary email can admit an account", async () => {
    const unverified = fixture("unverified");
    profiles.get(unverified.sub).email_addresses[0].verification.status = "unverified";
    await rejectedToken(tokenFor(unverified, { email: "forged@example.test", email_verified: true }));
    const missing = fixture("noemail", "");
    profiles.get(missing.sub).primary_email_address_id = null;
    profiles.get(missing.sub).email_addresses = [];
    await rejectedToken(tokenFor(missing));
    const secondary = fixture("secondary");
    profiles.get(secondary.sub).email_addresses[0].verification.status = "unverified";
    profiles.get(secondary.sub).email_addresses.push({ id: "verified-secondary", email_address: "secondary@example.test", verification: { status: "verified" } });
    await rejectedToken(tokenFor(secondary));
  });
  await check("provider outages and malformed identity responses fail closed without partial signup", async () => {
    for (const mode of ["network", "unavailable", "invalid_json"]) {
      const identity = fixture(`outage_${mode}`);
      const workspacesBefore = count("workspaces");
      providerFailure = mode;
      try { await rejectedToken(tokenFor(identity)); }
      finally { providerFailure = null; }
      assert.equal(count("workspaces"), workspacesBefore, "Failed provider lookup must not create an orphan workspace");
    }
    const mismatch = fixture("mismatch");
    profiles.get(mismatch.sub).id = "user_someone_else";
    await rejectedToken(tokenFor(mismatch));
  });
  await check("periodic profile refresh preserves subject identity and rejects newly unverified profiles", async () => {
    const identity = fixture("profile_refresh");
    const signed = await session(identity);
    const calls = providerCalls.filter((call) => call.path === `/v1/users/${identity.sub}`).length;
    assert.equal((await session(identity)).user.id, signed.user.id);
    assert.equal(providerCalls.filter((call) => call.path === `/v1/users/${identity.sub}`).length, calls, "Fresh verified profiles use the bounded cache");
    profiles.get(identity.sub).email_addresses[0].email_address = "changed@example.test";
    sqlite.prepare("UPDATE users SET identity_checked_at=0 WHERE id=?").run(signed.user.id);
    const changed = await session(identity);
    assert.equal(changed.user.id, signed.user.id);
    assert.equal(changed.workspace.id, signed.workspace.id);
    assert.equal(changed.user.email, "changed@example.test");
    profiles.get(identity.sub).email_addresses[0].verification.status = "unverified";
    sqlite.prepare("UPDATE users SET identity_checked_at=0 WHERE id=?").run(signed.user.id);
    await rejectedToken(tokenFor(identity));
    assert.equal(sqlite.prepare("SELECT workspace_id FROM users WHERE id=?").get(signed.user.id).workspace_id, signed.workspace.id, "Rejected profile refresh cannot reassign a workspace");
  });
  await check("a stale profile fails closed on provider outage and recovers without recreating its account", async () => {
    const identity = fixture("stale_profile");
    const signed = await session(identity);
    sqlite.prepare("UPDATE users SET identity_checked_at=0 WHERE id=?").run(signed.user.id);
    providerFailure = "network";
    try { await rejectedToken(tokenFor(identity)); }
    finally { providerFailure = null; }
    const recovered = await session(identity);
    assert.equal(recovered.user.id, signed.user.id);
    assert.equal(recovered.workspace.id, signed.workspace.id);
  });
  await check("different Clerk subjects sharing an email never merge accounts", async () => {
    const one = await session(fixture("sameemail_one", "shared@example.test"));
    const two = await session(fixture("sameemail_two", "shared@example.test"));
    assert.notEqual(one.user.id, two.user.id);
    assert.notEqual(one.workspace.id, two.workspace.id);
    assert.equal(one.user.email, two.user.email);
  });
  await check("the same external subject in different Clerk issuers has isolated ownership", async () => {
    const identity = fixture("issuer_namespace");
    const first = await session(identity);
    const secondIssuer = "https://other-relay.clerk.accounts.dev";
    const settings = { ...env, CLERK_ISSUER: secondIssuer, CLERK_PUBLISHABLE_KEY: "pk_test_" + Buffer.from(new URL(secondIssuer).hostname + "$").toString("base64") };
    const second = await session(identity, { claims: { iss: secondIssuer }, settings });
    assert.notEqual(first.user.id, second.user.id);
    assert.notEqual(first.workspace.id, second.workspace.id);
    assert.equal((await session(identity)).workspace.id, first.workspace.id, "Original issuer retains its workspace");
  });
  await check("Clerk identities never merge into legacy Google users by matching email", async () => {
    const legacyWorkspace = "ws_legacy_clerk_fixture";
    const legacyUser = "legacy_clerk_fixture";
    sqlite.prepare("INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)").run(legacyWorkspace, "Legacy account", Date.now());
    sqlite.prepare("INSERT INTO users(id,google_sub,identity_key,email,name,workspace_id,created_at) VALUES (?,?,?,?,?,?,?)").run(legacyUser, "google-legacy-subject", JSON.stringify(["google", "https://accounts.google.com", "google-legacy-subject"]), "legacy@example.test", "Legacy", legacyWorkspace, Date.now());
    const identity = await session(fixture("sameasgoogle", "legacy@example.test"));
    assert.notEqual(identity.user.id, legacyUser);
    assert.notEqual(identity.workspace.id, legacyWorkspace);
    assert.equal(sqlite.prepare("SELECT workspace_id FROM users WHERE id=?").get(legacyUser).workspace_id, legacyWorkspace);
  });
  await check("expired Clerk JWT cannot borrow a persisted native session's longer lifetime", async () => {
    const identity = fixture("duration");
    const valid = await session(identity);
    sqlite.prepare("UPDATE auth_sessions SET expires_at=? WHERE user_id=?").run(Date.now() + 30 * 86400000, valid.user.id);
    const now = Math.floor(Date.now() / 1000);
    await rejectedToken(tokenFor(identity, { iat: now - 120, nbf: now - 120, exp: now - 60 }));
    assert.equal((await session(identity)).user.id, valid.user.id, "A newly verified JWT restores this same account");
  });

  // Native MCP OAuth remains issued by the relay, independent of Clerk JWTs.
  const redirectUri = "http://127.0.0.1:8123/callback";
  const verifier = "a".repeat(64);
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  let clientId;
  function seedNativeGrant(signed, label) {
    const token = `access_synthetic_${label}`;
    const grantedAgent = `clerk-${label}-agent`;
    const grantId = `clerk-${label}-grant`;
    sqlite.prepare("INSERT INTO agents(id,name,token_hash,created_at,workspace_id,handle,can_request,can_work) VALUES (?,?,?,?,?,?,1,1)").run(grantedAgent, "Clerk grant fixture", `${label}-fixture-hash`, Date.now(), signed.workspace.id, label);
    const generation = sqlite.prepare("SELECT auth_generation FROM agents WHERE id=?").get(grantedAgent).auth_generation;
    sqlite.prepare("INSERT INTO oauth_grants(id,user_id,workspace_id,agent_id,auth_generation,client_id,scope,resource,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(grantId, signed.user.id, signed.workspace.id, grantedAgent, generation, clientId, "relay:read", base + "/mcp", Date.now());
    sqlite.prepare("INSERT INTO oauth_tokens(token_hash,grant_id,kind,created_at,expires_at) VALUES (?,?,'access',?,?)").run(createHash("sha256").update(token).digest("hex"), grantId, Date.now(), Date.now() + 600000);
    return () => request("/mcp", { headers: { authorization: `Bearer ${token}` } });
  }
  const authorizePath = () => "/oauth/authorize?" + new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: "relay:read relay:send offline_access", resource: base + "/mcp", state: "clerk-mcp-state" });
  const authHeaders = (token) => ({ authorization: `Bearer ${token}`, origin: base });
  const agentId = "clerk-alice-agent";
  let nativeTokens;
  sqlite.prepare("INSERT INTO agents(id,name,token_hash,created_at,workspace_id,handle,can_request,can_work) VALUES (?,?,?,?,?,?,1,1)").run(agentId, "Clerk fixture agent", "clerk-fixture-hash", Date.now(), alice.workspace.id, "codex");
  await check("native MCP consent survives Clerk JWT refresh without changing CSRF identity", async () => {
    const registration = await handle(request("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Clerk fixture MCP client", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }) }));
    assert.equal(registration.status, 201);
    clientId = (await registration.json()).client_id;
    const page = await handle(request(authorizePath(), { headers: authHeaders(alice.token) }));
    assert.equal(page.status, 200);
    const requestId = (await page.text()).match(/name="request_id" value="([^"]+)"/)?.[1];
    assert.ok(requestId);
    const refreshed = await session(aliceIdentity, { claims: { jti: "different-jwt-same-clerk-session" } });
    assert.equal(refreshed.csrfToken, alice.csrfToken);
    const consent = await handle(request("/oauth/authorize", form({ request_id: requestId, csrf_token: alice.csrfToken, agent_id: agentId, decision: "allow" }, authHeaders(refreshed.token))));
    assert.equal(consent.status, 303);
    const callback = new URL(consent.headers.get("location"));
    assert.equal(callback.origin + callback.pathname, redirectUri);
    assert.equal(callback.searchParams.get("state"), "clerk-mcp-state");
    const exchanged = await handle(request("/oauth/token", form({ grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, code: callback.searchParams.get("code"), code_verifier: verifier, resource: base + "/mcp" })));
    assert.equal(exchanged.status, 200);
    const tokens = await exchanged.json();
    nativeTokens = tokens;
    const actor = await auth.authenticateOAuth(request("/mcp", { headers: { authorization: `Bearer ${tokens.access_token}` } }), env);
    assert.equal(actor.workspaceId, alice.workspace.id);
    assert.equal(actor.agent.id, agentId);
  });
  await check("split Clerk consent retains its fixed connection through sign-in, JSON approval and token exchange", async () => {
    const frontend = "https://app.example.test", settings = { ...env, FRONTEND_URL: frontend };
    const signed = await session(fixture("split_fixed"), { claims: { azp: frontend }, settings });
    const headers = { authorization: `Bearer ${signed.token}`, origin: frontend, accept: "application/json" };
    for (const [id, name] of [["split-grok", "Scoped Grok"], ["split-other", "Other helper"]]) {
      sqlite.prepare("INSERT INTO agents(id,name,token_hash,created_at,workspace_id,handle,can_request,can_work) VALUES (?,?,?,?,?,?,1,1)").run(id, name, id + "-hash", Date.now(), signed.workspace.id, id);
    }
    const resource = base + "/mcp/connections/split-grok";
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: "relay:read relay:send offline_access", resource, state: "fixed-split-state" });
    const path = "/oauth/authorize?" + query;
    const signIn = await handle(request(path), settings);
    assert.equal(signIn.status, 303);
    const connect = new URL(signIn.headers.get("location"));
    assert.equal(connect.origin + connect.pathname, frontend + "/connect");
    assert.equal(connect.searchParams.get("resource"), resource, "Sign-in preserves the chosen connection resource");
    const response = await handle(request(path, { headers }), settings);
    assert.equal(response.status, 200);
    const consent = await response.json();
    assert.equal(consent.targetAgentId, "split-grok");
    assert.deepEqual(consent.agents.map(agent => agent.id), ["split-grok"]);
    const approval = { request_id: consent.requestId, csrf_token: consent.csrfToken, decision: "allow" };
    assert.equal((await handle(request("/oauth/authorize", form({ ...approval, agent_id: "split-other" }, headers)), settings)).status, 403);
    assert.equal((await handle(request("/oauth/authorize", form({ ...approval, agent_id: agentId }, headers)), settings)).status, 403);
    const approved = await handle(request("/oauth/authorize", form(approval, headers)), settings);
    assert.equal(approved.status, 200, "Fixed approval does not require a second connection selection");
    const callback = new URL((await approved.json()).redirectUrl);
    assert.equal(callback.origin + callback.pathname, redirectUri);
    assert.equal(callback.searchParams.get("state"), "fixed-split-state");
    const exchanged = await handle(request("/oauth/token", form({ grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, code: callback.searchParams.get("code"), code_verifier: verifier, resource })), settings);
    assert.equal(exchanged.status, 200);
    const tokens = await exchanged.json();
    const actor = await auth.authenticateOAuth(new Request(resource, { headers: { authorization: `Bearer ${tokens.access_token}` } }), settings);
    assert.equal(actor.agent.id, "split-grok");
    assert.equal(actor.workspaceId, signed.workspace.id);
    query.delete("resource");
    const generic = await handle(request("/oauth/authorize?" + query, { headers }), settings);
    assert.equal(generic.status, 200);
    const genericConsent = await generic.json();
    assert.equal(genericConsent.targetAgentId, null);
    assert.deepEqual(genericConsent.agents.map(agent => agent.id).sort(), ["split-grok", "split-other"], "Providers omitting resource keep the explicit owner choice");
  });
  await check("Clerk transport parameters never enter consent links or saved login returns", async () => {
    const clean=authorizePath(), marker="transport-secret-placeholder";
    const dirty=clean+"&"+new URLSearchParams({__clerk_handshake:marker,__clerk_db_jwt:marker,__clerk_handshake_nonce:marker,__clerk_redirect_url:marker,__CLERK_FUTURE_TRANSPORT:marker});
    const before=sqlite.prepare("SELECT count(*) AS n FROM oauth_requests").get().n;
    const canonical=await handle(request(dirty,{headers:{cookie:`__session=${alice.token}`}}));
    assert.equal(canonical.status,303);
    assert.equal(canonical.headers.get("location"),clean);
    assert.equal(canonical.headers.get("set-cookie"),null,"Clean navigation must not replace or clear the verified session cookie");
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM oauth_requests").get().n,before,"Clean transport before creating a consent request");
    const consent=await handle(request(clean,{headers:{cookie:`__session=${alice.token}`}}));
    assert.equal(consent.status,200);
    assert.doesNotMatch(await consent.text(),/__clerk|transport-secret-placeholder/i);
    const signedOut=await handle(request(dirty));
    assert.equal(signedOut.status,303);
    assert.equal(new URL(signedOut.headers.get("location"),base).searchParams.get("return_to"),clean);
    for (const path of ["/auth/start","/auth/clerk/start"]) {
      const result=await handle(request(path+"?return_to="+encodeURIComponent(dirty)));
      assert.doesNotMatch(result.headers.get("location") ?? "",/__clerk|transport-secret-placeholder/i);
      assert.doesNotMatch(await result.text(),/__clerk|transport-secret-placeholder/i);
    }
  });
  await check("real Worker admin routes accept Clerk bearer auth and enforce native CSRF", async () => {
    const response = await route(request("/v1/admin/overview", { headers: authHeaders(alice.token) }));
    assert.equal(response.status, 200, "Clerk bearer reaches protected Worker routes as the workspace owner");
    assert.ok((await response.json()).agents.some((agent) => agent.id === agentId));
    const settings = { method: "PATCH", headers: { ...authHeaders(alice.token), "content-type": "application/json" }, body: JSON.stringify({ name: "Clerk integration workspace" }) };
    assert.equal((await route(request("/v1/admin/workspace", settings))).status, 403, "Bearer browser mutations still require native CSRF");
    const changed = await route(request("/v1/admin/workspace", { ...settings, headers: { ...settings.headers, "x-csrf-token": alice.csrfToken } }));
    assert.equal(changed.status, 200);
    const other = await session(fixture("http_other"));
    const foreign = await route(request(`/v1/admin/agents/${agentId}/setup`, { headers: authHeaders(other.token) }));
    assert.equal(foreign.status, 404, "Other Clerk users cannot access this connection's setup");
  });
  await check("native MCP OAuth continues working during Clerk outage and cannot impersonate a browser owner", async () => {
    providerFailure = "unavailable";
    try {
      const response = await route(request("/mcp", { method: "POST", headers: { authorization: `Bearer ${nativeTokens.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
      assert.equal(response.status, 200, "Native MCP grants are independent of Clerk provider availability");
      assert.ok((await response.json()).result.tools.some((tool) => tool.name === "send_job"));
      assert.equal((await route(request("/v1/admin/overview", { headers: { authorization: `Bearer ${nativeTokens.access_token}` } }))).status, 403, "MCP connection token cannot become workspace owner");
    } finally { providerFailure = null; }
  });
  await check("signed-out MCP authorization uses Clerk and preserves the exact local consent return", async () => {
    const path = authorizePath();
    let response = await handle(request(path));
    for (let redirects = 0; [302, 303, 307].includes(response.status) && redirects < 3; redirects++) {
      const target = new URL(response.headers.get("location"), base);
      assert.equal(target.origin, base, "Sign-in stays on the relay's configured origin");
      assert.notEqual(target.pathname, "/auth/google/start", "Clerk deployments do not start direct Google authentication");
      if (target.searchParams.has("return_to")) assert.equal(target.searchParams.get("return_to"), path);
      response = await handle(new Request(target));
    }
    assert.equal(response.status, 200, "Signed-out native consent reaches the Clerk sign-in page");
    const page = await response.text();
    assert.ok(page.includes(clientId), "Sign-in page preserves the original MCP client request");
    assert.ok(page.includes(env.CLERK_PUBLISHABLE_KEY), "Clerk public configuration reaches the browser");
    assert.ok(!page.includes(env.CLERK_SECRET_KEY), "Clerk secret key never reaches the browser");
    const hostile = await handle(request("/auth/clerk/start?return_to=" + encodeURIComponent("https://attacker.example.test/capture")));
    assert.equal(hostile.status, 200);
    assert.ok(!(await hostile.text()).includes("attacker.example.test"), "Sign-in discards foreign return URLs");
  });
  await check("Clerk browser logout requires origin and native CSRF before provider revocation", async () => {
    const identity = fixture("logout");
    const signed = await session(identity);
    const logout = (headers) => handle(request("/auth/logout", { method: "POST", headers: { ...authHeaders(signed.token), ...headers } }));
    assert.equal((await logout({})).status, 403);
    assert.equal((await logout({ origin: "https://attacker.example.test", "x-csrf-token": signed.csrfToken })).status, 403);
    assert.equal(revokedSessions.has(identity.sid), false);
    assert.equal((await logout({ "x-csrf-token": signed.csrfToken })).status, 200);
    assert.equal(revokedSessions.has(identity.sid), true);
    await rejectedToken(signed.token);
    await rejectedToken(tokenFor(identity, { jti: "refreshed-after-local-logout" }));
  });
  await check("logout revokes local access even when the identity provider is unavailable", async () => {
    const identity = fixture("logoutoutage");
    const signed = await session(identity);
    providerFailure = "unavailable";
    try {
      const response = await handle(request("/auth/logout", { method: "POST", headers: { ...authHeaders(signed.token), "x-csrf-token": signed.csrfToken } }));
      assert.ok([200, 202, 503].includes(response.status), "Logout reports success or recoverable provider failure");
    } finally { providerFailure = null; }
    await rejectedToken(signed.token);
  });
  await check("account deletion tombstone blocks existing and new sessions from restoring deleted access", async () => {
    const identity = fixture("deleted");
    const signed = await session(identity);
    await auth.deleteHumanAccount(env, signed.user.id, signed.workspace.id);
    assert.equal(sqlite.prepare("SELECT id FROM users WHERE id=?").get(signed.user.id), undefined);
    const usersAfterDeletion = count("users");
    await rejectedToken(signed.token);
    providerSessions.set("sess_deleted_new", { ...providerSessions.get(identity.sid), id: "sess_deleted_new", status: "active" });
    await rejectedToken(tokenFor({ ...identity, sid: "sess_deleted_new" }));
    assert.equal(count("users"), usersAfterDeletion);
    const independent = await session(fixture("deleted_same_email_new_subject", identity.email));
    assert.notEqual(independent.workspace.id, signed.workspace.id, "Unrelated identity sharing the address has no access to deleted workspace");
  });
  await check("failed provider account deletion cannot resurrect local identity or leave native grants valid", async () => {
    const identity = fixture("deleteoutage");
    const signed = await session(identity);
    const nativeRequest = seedNativeGrant(signed, "deletion");
    assert.equal((await auth.authenticateOAuth(nativeRequest(), env)).workspaceId, signed.workspace.id, "Deletion fixture starts with valid native MCP access");
    providerFailure = "unavailable";
    try {
      try { await auth.deleteHumanAccount(env, signed.user.id, signed.workspace.id); }
      catch (error) { assert.ok(error?.status >= 400, "Provider deletion failure is surfaced as an auth error"); }
    } finally { providerFailure = null; }
    await rejectedToken(signed.token);
    assert.equal(await auth.authenticateOAuth(nativeRequest(), env), null, "Local deletion immediately revokes native MCP access despite provider outage");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM oauth_grants WHERE user_id=? AND revoked_at IS NULL").get(signed.user.id).n, 0);
  });
  await check("provider cleanup retries remain durable after local logout and deletion", async () => {
    const pending = sqlite.prepare("SELECT action,subject FROM clerk_actions").all();
    assert.ok(pending.some((row) => row.action === "revoke_session"), "Failed logout provider call is queued");
    assert.ok(pending.some((row) => row.action === "delete_user"), "Failed deletion provider call is queued");
    sqlite.exec("UPDATE clerk_actions SET next_attempt_at=0");
    await auth.cleanupAuth(env);
    for (const action of pending) assert.ok(action.action === "revoke_session" ? revokedSessions.has(action.subject) : deletedUsers.has(action.subject), "Scheduled cleanup retries the exact failed provider action");
    assert.equal(count("clerk_actions"), 0, "Successfully retried provider actions are removed");
  });
  await check("deletion survives interruption immediately after its first durable transaction", async () => {
    const identity = fixture("deletion_interrupted");
    const signed = await session(identity);
    const nativeRequest = seedNativeGrant(signed, "deletion-interrupted");
    let interrupted = false;
    const interruptedDB = { ...DB, async batch(statements) {
      const results = await DB.batch(statements);
      if (!interrupted) { interrupted = true; throw new Error("Synthetic process interruption after committed transaction"); }
      return results;
    } };
    await assert.rejects(auth.deleteHumanAccount({ ...env, DB: interruptedDB }, signed.user.id, signed.workspace.id), /Synthetic process interruption/);
    assert.equal(sqlite.prepare("SELECT workspace_id FROM account_deletions WHERE user_id=?").get(signed.user.id)?.workspace_id, signed.workspace.id);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM clerk_actions WHERE action='delete_user' AND subject=?").get(identity.sub).n, 1, "Provider deletion is queued in the same first transaction as the local tombstone");
    assert.equal(deletedUsers.has(identity.sub), false, "The interruption happens before the provider API call");
    await rejectedToken(signed.token);
    assert.equal(await auth.authenticateOAuth(nativeRequest(), env), null, "Deletion marker blocks existing native grants before later cleanup");
    await auth.cleanupAuth(env);
    assert.equal(deletedUsers.has(identity.sub), true, "Maintenance executes the durable provider deletion after the process interruption");
    assert.equal(sqlite.prepare("SELECT id FROM users WHERE id=?").get(signed.user.id), undefined);
    assert.equal(sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(signed.workspace.id), undefined);
    assert.equal(sqlite.prepare("SELECT user_id FROM account_deletions WHERE user_id=?").get(signed.user.id), undefined);
    await rejectedToken(tokenFor({ ...identity, sid: "sess_deletion_interrupted_new" }));
  });
  await check("webhook signatures and timestamps are verified before changing access", async () => {
    const identity = fixture("webhook_invalid");
    const signed = await session(identity);
    const event = { id: identity.sub, deleted: true, object: "user" };
    assert.equal((await handle(signedWebhook("user.deleted", event, { invalid: true }))).status, 400);
    assert.equal((await handle(signedWebhook("user.deleted", event, { timestamp: Math.floor(Date.now() / 1000) - 600 }))).status, 400);
    assert.equal((await session(identity)).user.id, signed.user.id, "Invalid webhooks cannot delete the account");
  });
  await check("signed session-ended and session-revoked webhooks block replayed Clerk sessions", async () => {
    for (const type of ["session.ended", "session.revoked"]) {
      const identity = fixture(type.replace(".", "_"));
      const signed = await session(identity);
      const event = { id: identity.sid, user_id: identity.sub, object: "session" };
      const options = { id: `msg_${identity.sid}` };
      assert.equal((await handle(signedWebhook(type, event, options))).status, 200);
      await rejectedToken(signed.token);
      assert.equal((await handle(signedWebhook(type, event, options))).status, 200, "Valid webhook redelivery is idempotent");
      await rejectedToken(tokenFor(identity, { jti: "replayed-after-webhook" }));
    }
  });
  await check("signed user updates invalidate cached profiles and revoke unsafe accounts", async () => {
    for (const condition of ["banned", "locked", "unverified"]) {
      const identity = fixture(`webhook_${condition}`);
      const signed = await session(identity);
      const nativeRequest = seedNativeGrant(signed, `webhook-${condition}`);
      assert.ok(await auth.authenticateOAuth(nativeRequest(), env));
      const profile = profiles.get(identity.sub);
      if (condition === "unverified") profile.email_addresses[0].verification.status = "unverified";
      else profile[condition] = true;
      assert.equal((await handle(signedWebhook("user.updated", profile))).status, 200);
      await rejectedToken(signed.token);
      assert.equal(await auth.authenticateOAuth(nativeRequest(), env), null, "Provider account restriction revokes native MCP grants too");
      assert.equal(sqlite.prepare("SELECT identity_checked_at FROM users WHERE id=?").get(signed.user.id).identity_checked_at, 0, "Webhook invalidates verified profile cache");
    }
  });
  await check("signed user-deleted webhook clears owned data and cannot restore a deleted identity", async () => {
    const identity = fixture("webhook_deleted");
    const signed = await session(identity);
    const nativeRequest = seedNativeGrant(signed, "webhook-deleted");
    assert.ok(await auth.authenticateOAuth(nativeRequest(), env));
    const event = { id: identity.sub, deleted: true, object: "user" };
    const options = { id: "msg_duplicate_user_deletion" };
    assert.equal((await handle(signedWebhook("user.deleted", event, options))).status, 200);
    assert.equal(sqlite.prepare("SELECT id FROM users WHERE id=?").get(signed.user.id), undefined);
    assert.equal(sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(signed.workspace.id), undefined);
    assert.equal(await auth.authenticateOAuth(nativeRequest(), env), null);
    await rejectedToken(signed.token);
    assert.equal((await handle(signedWebhook("user.deleted", event, options))).status, 200, "Repeated deletion remains safe");
    await rejectedToken(tokenFor({ ...identity, sid: "sess_webhook_deleted_new" }));
    assert.equal((await session(aliceIdentity)).workspace.id, alice.workspace.id, "Other users retain their own workspace");
  });
  console.log(`\n${passed} Clerk authentication checks passed.`);
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
  await rm(temporary, { recursive: true, force: true });
}
