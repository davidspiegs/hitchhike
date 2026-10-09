/** Account-boundary regressions use fully migrated in-memory SQLite and the
 * real Clerk SDK with generated signatures. Only fixed Clerk API requests are
 * handled locally; unexpected fetches fail before any network operation. */
import assert from "node:assert/strict";
import { createHash, createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "relay-auth-boundary-"));
const sqlite = new DatabaseSync(":memory:");
const originalFetch = globalThis.fetch;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const base = "https://relay.example.test";
const issuer = "https://boundary-test.clerk.accounts.dev";
const webhookKey = Buffer.from("synthetic-account-boundary-webhook-secret");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const profiles = new Map();
const providerCalls = [];
let serial = 0, passed = 0;
let profileResponseHook = null;
let statementRunHook = null;

class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() {
    if (statementRunHook) await statementRunHook(this.sql, this.values);
    return { meta: sqlite.prepare(this.sql).run(...this.values), success: true };
  }
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
  DB, HOSTED: "true", AUTH_PROVIDER: "clerk", SIGNUP_MODE: "public", PUBLIC_URL: base,
  ENCRYPTION_KEY: "synthetic-boundary-encryption-fixture-only",
  CLERK_PUBLISHABLE_KEY: "pk_test_" + Buffer.from(new URL(issuer).hostname + "$").toString("base64"),
  CLERK_SECRET_KEY: "sk_test_synthetic_boundary_fixture_only", CLERK_ISSUER: issuer,
  CLERK_JWT_KEY: publicKey.export({ format: "pem", type: "spki" }).toString(),
  CLERK_ALLOW_DEVELOPMENT: "true", CLERK_WEBHOOK_SIGNING_SECRET: "whsec_" + webhookKey.toString("base64"),
};
const request = (path, options = {}) => new Request(base + path, options);
const check = async (name, fn) => { await fn(); console.log(`ok ${++passed} - ${name}`); };
const get = (sql, ...values) => sqlite.prepare(sql).get(...values);
const run = (sql, ...values) => sqlite.prepare(sql).run(...values);

function identity(label) {
  const id = ++serial, sub = `user_${label}_${id}`, sid = `sess_${label}_${id}`;
  const email = `${label}-${id}@example.test`, emailId = `email_${id}`, now = Date.now();
  profiles.set(sub, {
    object: "user", id: sub, username: null, first_name: "Boundary", last_name: label,
    primary_email_address_id: emailId,
    email_addresses: [{ object: "email_address", id: emailId, email_address: email, verification: { status: "verified", strategy: "email_code" }, linked_to: [] }],
    external_accounts: [], phone_numbers: [], web3_wallets: [], passkeys: [],
    public_metadata: {}, private_metadata: {}, unsafe_metadata: {},
    created_at: now, updated_at: now, banned: false, locked: false,
  });
  return { sub, sid, email };
}
function tokenFor(person) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, azp: base, sub: person.sub, sid: person.sid, iat: now, nbf: now - 1, exp: now + 60, v: 2, fva: [0, -1], sts: "active" };
  const unsigned = encode({ alg: "RS256", typ: "JWT", kid: "local-boundary-key" }) + "." + encode(claims);
  return unsigned + "." + createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
}
function signedWebhook(type, data) {
  const timestamp = Math.floor(Date.now() / 1000), id = `msg_boundary_${++serial}`;
  const body = JSON.stringify({ object: "event", type, data, timestamp: timestamp * 1000 });
  const signature = createHmac("sha256", webhookKey).update(`${id}.${timestamp}.${body}`).digest("base64");
  return request("/auth/clerk/webhook", { method: "POST", headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": "v1," + signature }, body });
}

globalThis.fetch = async (input, options) => {
  const req = input instanceof Request ? input : new Request(input, options), url = new URL(req.url);
  assert.equal(url.origin, "https://api.clerk.com", "External requests are blocked; only locally mocked Clerk endpoints are allowed");
  assert.equal(req.headers.get("authorization"), `Bearer ${env.CLERK_SECRET_KEY}`);
  providerCalls.push({ method: req.method, path: url.pathname });
  const userId = url.pathname.match(/^\/v1\/users\/([^/]+)$/)?.[1];
  if (userId && req.method === "GET" && profiles.has(userId)) {
    const profile = structuredClone(profiles.get(userId));
    if (profileResponseHook) await profileResponseHook(userId);
    return Response.json(profile);
  }
  throw new Error(`Unexpected mocked Clerk request: ${req.method} ${url.pathname}`);
};

try {
  for (const file of (await readdir(join(root, "migrations"))).filter((file) => file.endsWith(".sql")).sort()) sqlite.exec(await readFile(join(root, "migrations", file), "utf8"));
  const modulePath = join(temporary, "auth.mjs");
  await build({ stdin: { contents: "export * from './src/auth';", resolveDir: root }, bundle: true, platform: "node", format: "esm", outfile: modulePath, logLevel: "silent" });
  const auth = await import(pathToFileURL(modulePath).href);
  assert.equal(typeof auth.workspaceAccountAllowed, "function", "Account boundary must be exported for all capability entry points");
  const handle = (req, settings = env) => auth.handleAuth(req, settings);
  const ownerRequest = (person) => request("/auth/session", { headers: { authorization: `Bearer ${tokenFor(person)}` } });
  async function owner(person, settings = env) {
    const response = await handle(ownerRequest(person), settings), data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.authenticated, true, "Verified owner must authenticate");
    return { ...data, person };
  }
  async function deniedOwner(person, settings = env) {
    const response = await handle(ownerRequest(person), settings), data = await response.json();
    assert.ok(response.status >= 400 || data.authenticated === false, "Restricted owner cannot authenticate");
  }
  const fresh = (person) => ({ ...person, sid: `sess_fresh_${++serial}` });
  function seedCapabilities(signed, label, scope = "relay:read relay:send relay:work offline_access") {
    const now = Date.now(), agentId = `agent_${label}_${++serial}`, rawKey = `key_synthetic_${serial}`;
    const clientId = `client_${serial}`, grantId = `grant_${serial}`, access = `access_synthetic_${serial}`;
    const claimHash = hash(`claim_synthetic_${serial}`), pairingHash = hash(`pair_synthetic_${serial}`), jobId = `job_${serial}`;
    run("INSERT INTO agents(id,name,token_hash,key_ciphertext,can_request,can_work,workspace_id,handle,created_at) VALUES (?,?,?,?,1,1,?,?,?)", agentId, label, hash(rawKey), "synthetic-encrypted-key", signed.workspace.id, label, now);
    run("INSERT INTO jobs(id,workspace_id,v,type,from_agent,to_agent,title,spec,status,lease_holder,lease_seconds,lease_expires_at,created_at,updated_at) VALUES (?,?,'1','test',?,?,'Fixture','{}','claimed',?,600,?,?,?)", jobId, signed.workspace.id, agentId, agentId, agentId, now + 600000, now, now);
    run("INSERT INTO claims(token_hash,job_id,agent_id,attempt,issued_at,workspace_id,auth_generation,expires_at) VALUES (?,?,?,1,?,?,1,?)", claimHash, jobId, agentId, now, signed.workspace.id, now + 600000);
    run("INSERT INTO pairing_codes(code_hash,workspace_id,agent_id,auth_generation,created_at,expires_at) VALUES (?,?,?,1,?,?)", pairingHash, signed.workspace.id, agentId, now, now + 600000);
    run("INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES (?,?,'[\"https://client.example.test/callback\"]',?)", clientId, label, now);
    run("INSERT INTO oauth_grants(id,user_id,workspace_id,agent_id,auth_generation,client_id,scope,resource,created_at) VALUES (?,?,?,?,1,?,?,?,?)", grantId, signed.user.id, signed.workspace.id, agentId, clientId, scope, base + "/mcp", now);
    run("INSERT INTO oauth_tokens(token_hash,grant_id,kind,created_at,expires_at) VALUES (?,?,'access',?,?)", hash(access), grantId, now, now + 600000);
    return { signed, agentId, rawKey, grantId, clientId, claimHash, pairingHash, request: () => request("/mcp", { headers: { authorization: `Bearer ${access}` } }) };
  }
  function assertRevoked(capabilities) {
    const { signed, agentId, rawKey, grantId, claimHash, pairingHash } = capabilities;
    assert.ok(get("SELECT auth_generation FROM agents WHERE id=?", agentId).auth_generation > 1, "Restriction advances capability generation");
    const claim = get("SELECT revoked_at FROM claims WHERE token_hash=?", claimHash);
    assert.ok(!claim || claim.revoked_at !== null, "Claim capability is permanently revoked");
    assert.equal(get("SELECT 1 FROM pairing_codes WHERE code_hash=?", pairingHash), undefined, "Unredeemed pairing codes are deleted");
    const grant = get("SELECT revoked_at FROM oauth_grants WHERE id=?", grantId);
    assert.ok(!grant || grant.revoked_at !== null, "OAuth grant is permanently revoked");
    assert.equal(get("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?", signed.user.id).n, 0, "Old owner sessions are revoked");
    assert.equal(get("SELECT token_hash FROM agents WHERE id=?", agentId).token_hash, hash(rawKey), "Paired static key is held behind the account boundary without rewriting credentials");
  }
  async function assertAllowed(capabilities, settings = env) {
    assert.equal(await auth.workspaceAccountAllowed(settings, capabilities.signed.workspace.id), true);
    assert.ok(await auth.authenticateOAuth(capabilities.request(), settings), "Unaffected OAuth capability stays valid");
    assert.equal(get("SELECT auth_generation FROM agents WHERE id=?", capabilities.agentId).auth_generation, 1);
    assert.equal(get("SELECT revoked_at FROM claims WHERE token_hash=?", capabilities.claimHash).revoked_at, null);
  }

  await check("self-hosted operation needs no hosted owner rows; hosted orphan workspaces fail closed", async () => {
    const noDatabase = { HOSTED: "false", DB: { prepare() { throw new Error("Self-hosted guard must not query hosted ownership"); } } };
    assert.equal(await auth.workspaceAccountAllowed(noDatabase, "default"), true);
    assert.equal(await auth.workspaceAccountAllowed({ ...noDatabase, HOSTED: undefined }, "default"), true);
    assert.equal(await auth.workspaceAccountAllowed(env, "default"), false);
    assert.equal(await auth.workspaceAccountAllowed(env, "nonexistent-workspace"), false);
  });

  await check("new hosted workspaces receive the 32 MiB storage default and respect an explicit signup override", async () => {
    const person = identity("storage_default"), standard = await owner(person);
    assert.equal(get("SELECT storage_limit_bytes FROM workspaces WHERE id=?", standard.workspace.id).storage_limit_bytes, 32 * 1024 * 1024);
    const override = { ...env, DEFAULT_STORAGE_LIMIT_BYTES: String(6 * 1024 * 1024) };
    const configured = await owner(identity("storage_override"), override);
    assert.equal(get("SELECT storage_limit_bytes FROM workspaces WHERE id=?", configured.workspace.id).storage_limit_bytes, 6 * 1024 * 1024);
    await owner(fresh(person), override);
    assert.equal(get("SELECT storage_limit_bytes FROM workspaces WHERE id=?", standard.workspace.id).storage_limit_bytes, 32 * 1024 * 1024, "Signup defaults cannot reset an existing workspace's stored quota");
  });

  const unaffected = seedCapabilities(await owner(identity("unaffected")), "unaffected");
  await check("owner pause preserves authentication and already-issued reading capabilities", async () => {
    const signed = await owner(identity("paused")), capabilities = seedCapabilities(signed, "paused");
    run("UPDATE workspaces SET paused=1 WHERE id=?", signed.workspace.id);
    assert.equal(await auth.workspaceAccountAllowed(env, signed.workspace.id), true);
    await owner(signed.person);
    await assertAllowed(capabilities);
  });

  await check("OAuth permissions intersect current agent roles without granting absent scopes", async () => {
    const signed = await owner(identity("roles")), capabilities = seedCapabilities(signed, "roles");
    const scopes = async () => (await auth.authenticateOAuth(capabilities.request(), env))?.scopes;
    assert.deepEqual(await scopes(), ["relay:read", "relay:send", "relay:work", "offline_access"]);
    run("UPDATE agents SET can_request=0 WHERE id=?", capabilities.agentId);
    assert.deepEqual(await scopes(), ["relay:read", "relay:work", "offline_access"]);
    run("UPDATE agents SET can_work=0 WHERE id=?", capabilities.agentId);
    assert.deepEqual(await scopes(), ["relay:read", "offline_access"], "Stored relay:read survives removal of send/work roles");
    run("UPDATE agents SET can_request=1,can_work=1 WHERE id=?", capabilities.agentId);
    run("UPDATE oauth_grants SET scope='relay:read' WHERE id=?", capabilities.grantId);
    assert.deepEqual(await scopes(), ["relay:read"], "Agent role upgrades cannot add scopes that the owner never granted");
  });

  for (const condition of ["banned", "locked", "unverified"]) {
    await check(`signed ${condition} update restricts every capability; stale verified webhook cannot restore`, async () => {
      const person = identity(condition), signed = await owner(person), capabilities = seedCapabilities(signed, condition);
      const prior = structuredClone(profiles.get(person.sub)), restricted = profiles.get(person.sub);
      if (condition === "unverified") restricted.email_addresses[0].verification.status = "unverified";
      else restricted[condition] = true;
      assert.equal((await handle(signedWebhook("user.updated", restricted))).status, 200);
      assert.equal(await auth.workspaceAccountAllowed(env, signed.workspace.id), false);
      await deniedOwner(person);
      assert.equal(await auth.authenticateOAuth(capabilities.request(), env), null);
      assertRevoked(capabilities);
      const identityHash = get("SELECT identity_hash FROM users WHERE id=?", signed.user.id).identity_hash;
      const before = get("SELECT restricted,version FROM identity_security WHERE identity_hash=?", identityHash);
      assert.equal(before.restricted, 1);
      assert.ok(before.version > 0);
      assert.equal(get("SELECT identity_restricted FROM workspaces WHERE id=?", signed.workspace.id).identity_restricted, 1);
      assert.equal((await handle(signedWebhook("user.updated", prior))).status, 200);
      assert.equal(await auth.workspaceAccountAllowed(env, signed.workspace.id), false, "A delayed safe event is not fresh provider authentication");
      assert.equal(get("SELECT restricted FROM identity_security WHERE identity_hash=?", identityHash).restricted, 1);
      const providerCallsBefore = providerCalls.length;
      await deniedOwner(fresh(person));
      assert.ok(providerCalls.length > providerCallsBefore, "Recovery reads the live provider profile instead of trusting the webhook payload");
      profiles.set(person.sub, prior);
      const restored = await owner(fresh(person));
      assert.equal(restored.workspace.id, signed.workspace.id, "Recovery preserves the same owner and workspace");
      assert.equal(await auth.workspaceAccountAllowed(env, signed.workspace.id), true);
      assert.equal(get("SELECT restricted FROM identity_security WHERE identity_hash=?", identityHash).restricted, 0);
      assert.equal(get("SELECT identity_restricted FROM workspaces WHERE id=?", signed.workspace.id).identity_restricted, 0);
      await deniedOwner(person);
      assert.equal(await auth.authenticateOAuth(capabilities.request(), env), null, "Provider recovery never resurrects old OAuth grants");
      const claim = get("SELECT revoked_at FROM claims WHERE token_hash=?", capabilities.claimHash);
      assert.ok(!claim || claim.revoked_at !== null, "Provider recovery never resurrects old claim tokens");
      await assertAllowed(unaffected);
    });
  }

  await check("a restriction arriving during a live provider read cannot be cleared by the older verified response", async () => {
    const person = identity("profile_race"), signed = await owner(person), capabilities = seedCapabilities(signed, "profile_race");
    run("UPDATE users SET identity_checked_at=0 WHERE id=?", signed.user.id);
    let release, signalStarted;
    const responseGate = new Promise((resolve) => { release = resolve; });
    const providerStarted = new Promise((resolve) => { signalStarted = resolve; });
    profileResponseHook = async (userId) => {
      if (userId !== person.sub) return;
      signalStarted();
      await responseGate;
    };
    const inFlight = handle(ownerRequest(fresh(person)));
    await providerStarted;
    try {
      profiles.get(person.sub).banned = true;
      assert.equal((await handle(signedWebhook("user.updated", profiles.get(person.sub)))).status, 200);
    } finally {
      profileResponseHook = null;
      release();
    }
    const response = await inFlight, data = await response.json();
    assert.ok(response.status >= 400 || data.authenticated === false, "A pre-restriction profile snapshot cannot authenticate after the restriction");
    assert.equal(await auth.workspaceAccountAllowed(env, signed.workspace.id), false);
    assert.equal(await auth.authenticateOAuth(capabilities.request(), env), null);
    assertRevoked(capabilities);
    await assertAllowed(unaffected);
  });

  await check("invite removal revokes capabilities and readding the email requires fresh verified authentication", async () => {
    const person = identity("invite"), invited = { ...env, SIGNUP_MODE: "invite", BETA_EMAILS: `${person.email},${unaffected.signed.person.email}` };
    const signed = await owner(person, invited), capabilities = seedCapabilities(signed, "invite");
    const removed = { ...invited, BETA_EMAILS: unaffected.signed.person.email };
    assert.equal(await auth.workspaceAccountAllowed(removed, signed.workspace.id), false);
    await deniedOwner(person, removed);
    assert.equal(await auth.authenticateOAuth(capabilities.request(), removed), null);
    assertRevoked(capabilities);
    await assertAllowed(unaffected, removed);
    assert.equal(await auth.workspaceAccountAllowed(invited, signed.workspace.id), false, "An allowlist change alone cannot reactivate revoked capabilities");
    await owner(fresh(person), invited);
    assert.equal(await auth.workspaceAccountAllowed(invited, signed.workspace.id), true);
    await deniedOwner(person, invited);
    assert.equal(await auth.authenticateOAuth(capabilities.request(), invited), null);
  });

  await check("a newly verified but uninvited provider email restricts capabilities through profile refresh and webhook", async () => {
    for (const path of ["profile", "webhook"]) {
      const person = identity(`changed_email_${path}`), invited = { ...env, SIGNUP_MODE: "invite", BETA_EMAILS: `${person.email},${unaffected.signed.person.email}` };
      const signed = await owner(person, invited), capabilities = seedCapabilities(signed, `changed_email_${path}`);
      const newEmail = `not-invited-${path}@example.test`, profile = profiles.get(person.sub);
      profile.email_addresses[0].email_address = newEmail;
      if (path === "profile") {
        run("UPDATE users SET identity_checked_at=0 WHERE id=?", signed.user.id);
        await deniedOwner(fresh(person), invited);
      } else {
        assert.equal((await handle(signedWebhook("user.updated", profile), invited)).status, 200);
      }
      assert.equal(await auth.workspaceAccountAllowed(invited, signed.workspace.id), false, "Stored formerly approved email cannot keep paired credentials authorized");
      assert.equal(await auth.authenticateOAuth(capabilities.request(), invited), null);
      assertRevoked(capabilities);
      const reinvited = { ...invited, BETA_EMAILS: `${invited.BETA_EMAILS},${newEmail}` };
      assert.equal(await auth.workspaceAccountAllowed(reinvited, signed.workspace.id), false, "Adding the new email alone does not resurrect revoked capabilities");
      const recovered = await owner(fresh(person), reinvited);
      assert.equal(recovered.user.email, newEmail);
      assert.equal(recovered.workspace.id, signed.workspace.id);
      assert.equal(await auth.workspaceAccountAllowed(reinvited, signed.workspace.id), true);
      assert.equal(await auth.authenticateOAuth(capabilities.request(), reinvited), null);
      await assertAllowed(unaffected, invited);
    }
  });

  await check("operator suspension denies owner and OAuth access and survives fresh verified provider login", async () => {
    const person = identity("suspended"), signed = await owner(person), capabilities = seedCapabilities(signed, "suspended");
    run("UPDATE workspaces SET security_suspended=1 WHERE id=?", signed.workspace.id);
    assert.equal(await auth.workspaceAccountAllowed(env, signed.workspace.id), false);
    await deniedOwner(person);
    await deniedOwner(fresh(person));
    assert.equal(await auth.authenticateOAuth(capabilities.request(), env), null);
    assertRevoked(capabilities);
    assert.equal(get("SELECT security_suspended FROM workspaces WHERE id=?", signed.workspace.id).security_suspended, 1, "Only an operator can clear operator suspension");
    await assertAllowed(unaffected);
  });

  await check("deletion markers and restricted identity records deny the exact workspace without spilling into another owner", async () => {
    for (const marker of ["deletion", "tombstone", "restricted_identity"]) {
      const person = identity(marker), signed = await owner(person), capabilities = seedCapabilities(signed, marker);
      if (marker === "deletion") run("INSERT INTO account_deletions(user_id,workspace_id,created_at) VALUES (?,?,?)", signed.user.id, signed.workspace.id, Date.now());
      else if (marker === "tombstone") run("INSERT INTO identity_tombstones(identity_hash,created_at) SELECT identity_hash,? FROM users WHERE id=?", Date.now(), signed.user.id);
      else run("INSERT INTO identity_security(identity_hash,restricted,version,reason,updated_at) SELECT identity_hash,1,1,'provider',? FROM users WHERE id=?", Date.now(), signed.user.id);
      assert.equal(await auth.workspaceAccountAllowed(env, signed.workspace.id), false);
      assert.equal(await auth.authenticateOAuth(capabilities.request(), env), null);
      if (marker !== "restricted_identity") await deniedOwner(person);
      await assertAllowed(unaffected);
    }
  });

  await check("a grant cannot borrow another owner's permitted workspace or agent", async () => {
    const signed = await owner(identity("mismatched")), capabilities = seedCapabilities(signed, "mismatched");
    run("UPDATE oauth_grants SET workspace_id=? WHERE id=?", unaffected.signed.workspace.id, capabilities.grantId);
    assert.equal(await auth.authenticateOAuth(capabilities.request(), env), null);
    run("UPDATE oauth_grants SET workspace_id=?,agent_id=? WHERE id=?", signed.workspace.id, unaffected.agentId, capabilities.grantId);
    assert.equal(await auth.authenticateOAuth(capabilities.request(), env), null);
    await assertAllowed(unaffected);
  });

  await check("signup capacity is enforced atomically without orphan users or workspaces, while existing owners remain available", async () => {
    const workspaceCount = get("SELECT COUNT(*) AS n FROM workspaces WHERE id<>'default'").n;
    const usersBefore = get("SELECT COUNT(*) AS n FROM users").n;
    const closed = { ...env, HOSTED_WORKSPACE_LIMIT: "0" };
    assert.equal((await handle(ownerRequest(identity("capacity_closed")), closed)).status, 429, "A zero limit closes new signup");
    assert.equal((await owner(fresh(unaffected.signed.person), closed)).workspace.id, unaffected.signed.workspace.id, "A zero signup limit leaves existing owners available");
    const settings = { ...env, HOSTED_WORKSPACE_LIMIT: String(workspaceCount) };
    const blockedPerson = identity("capacity_blocked");
    const denied = await handle(ownerRequest(blockedPerson), settings);
    assert.equal(denied.status, 429);
    assert.equal((await denied.json()).error, "signup_capacity");
    assert.equal(get("SELECT COUNT(*) AS n FROM workspaces WHERE id<>'default'").n, workspaceCount);
    assert.equal(get("SELECT COUNT(*) AS n FROM users").n, usersBefore);
    assert.equal(get("SELECT COUNT(*) AS n FROM users WHERE email=?", blockedPerson.email).n, 0);
    const existing = await owner(fresh(unaffected.signed.person), settings);
    assert.equal(existing.workspace.id, unaffected.signed.workspace.id);
    const oneSlot = { ...settings, HOSTED_WORKSPACE_LIMIT: String(workspaceCount + 1) };
    await owner(identity("capacity_last_slot"), oneSlot);
    const nextDenied = await handle(ownerRequest(identity("capacity_after_last_slot")), oneSlot);
    assert.equal(nextDenied.status, 429);
    assert.equal(get("SELECT COUNT(*) AS n FROM workspaces WHERE id<>'default'").n, workspaceCount + 1);
    assert.equal(get("SELECT COUNT(*) AS n FROM users").n, usersBefore + 1);
    assert.equal(get("SELECT COUNT(*) AS n FROM workspaces w WHERE w.id<>'default' AND NOT EXISTS(SELECT 1 FROM users u WHERE u.workspace_id=w.id)").n, 0, "Denied signup cannot create an unowned workspace");
  });

  const tokenRequest = (body, settings = env) => handle(request("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.54" }, body: new URLSearchParams(body) }), settings);
  async function exchangeFixtureCode(capabilities, label, settings = env) {
    const code = `code_synthetic_${label}`, verifier = "v".repeat(64), redirect = "https://client.example.test/callback";
    run("INSERT INTO oauth_codes(code_hash,grant_id,redirect_uri,code_challenge,expires_at) VALUES (?,?,?,?,?)", hash(code), capabilities.grantId, redirect, createHash("sha256").update(verifier).digest("base64url"), Date.now() + 600000);
    const response = await tokenRequest({ grant_type: "authorization_code", client_id: capabilities.clientId, redirect_uri: redirect, code, code_verifier: verifier, resource: base + "/mcp" }, settings);
    assert.equal(response.status, 200);
    const tokens = await response.json();
    assert.ok(tokens.access_token && tokens.refresh_token);
    return tokens;
  }
  const refreshFixture = (capabilities, token, scope, settings = env) => tokenRequest({ grant_type: "refresh_token", client_id: capabilities.clientId, refresh_token: token, resource: base + "/mcp", ...(scope === undefined ? {} : { scope }) }, settings);
  const scopeSet = (scopes) => [...new Set(typeof scopes === "string" ? scopes.split(/\s+/).filter(Boolean) : scopes)].sort();
  const accessActor = (access) => auth.authenticateOAuth(request("/mcp", { headers: { authorization: `Bearer ${access}` } }), env);

  await check("refresh accepts equivalent scope ordering and subsets while rejecting expansion beyond the presenting token or grant", async () => {
    const signed = await owner(identity("refresh_scope")), capabilities = seedCapabilities(signed, "refresh_scope");
    const initial = await exchangeFixtureCode(capabilities, "refresh_scope");
    const reorderedResponse = await refreshFixture(capabilities, initial.refresh_token, "offline_access relay:work relay:send relay:read");
    assert.equal(reorderedResponse.status, 200, "OAuth scope is a set, so equivalent ordering is valid");
    const reordered = await reorderedResponse.json();
    assert.deepEqual(scopeSet(reordered.scope), scopeSet(initial.scope));
    const subsetResponse = await refreshFixture(capabilities, reordered.refresh_token, "offline_access relay:read");
    assert.equal(subsetResponse.status, 200);
    const subset = await subsetResponse.json();
    assert.deepEqual(scopeSet(subset.scope), ["offline_access", "relay:read"]);
    assert.deepEqual(scopeSet((await accessActor(subset.access_token)).scopes), scopeSet(subset.scope), "Access enforcement matches the narrowed scope echoed in the response");
    for (const rejectedScope of ["relay:read relay:admin offline_access", "relay:read relay:send offline_access"]) {
      const rejected = await refreshFixture(capabilities, subset.refresh_token, rejectedScope);
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).error, "invalid_scope");
      assert.equal(get("SELECT used_at FROM oauth_tokens WHERE token_hash=?", hash(subset.refresh_token)).used_at, null, "Invalid scope cannot consume the valid refresh");
    }
    const omittedResponse = await refreshFixture(capabilities, subset.refresh_token);
    assert.equal(omittedResponse.status, 200);
    const omitted = await omittedResponse.json();
    assert.deepEqual(scopeSet(omitted.scope), scopeSet(subset.scope), "Omitted scope inherits the narrowed presenting token, not the original broader grant");
    assert.deepEqual(scopeSet((await accessActor(omitted.access_token)).scopes), scopeSet(subset.scope));
    const readOnlyScopeResponse = await refreshFixture(capabilities, omitted.refresh_token, "relay:read");
    assert.equal(readOnlyScopeResponse.status, 200);
    const readOnlyScope = await readOnlyScopeResponse.json();
    assert.deepEqual(scopeSet(readOnlyScope.scope), ["relay:read"]);
    assert.ok(readOnlyScope.refresh_token, "An original offline grant remains rotatable when the requested scope omits offline_access");
    const readOnlyScopeAgainResponse = await refreshFixture(capabilities, readOnlyScope.refresh_token);
    assert.equal(readOnlyScopeAgainResponse.status, 200);
    const readOnlyScopeAgain = await readOnlyScopeAgainResponse.json();
    assert.deepEqual(scopeSet(readOnlyScopeAgain.scope), ["relay:read"]);
    assert.ok(readOnlyScopeAgain.refresh_token);
    const readOnly = seedCapabilities(await owner(identity("refresh_grant_scope")), "refresh_grant_scope", "relay:read offline_access");
    const readOnlyTokens = await exchangeFixtureCode(readOnly, "refresh_grant_scope");
    const beyondGrant = await refreshFixture(readOnly, readOnlyTokens.refresh_token, "relay:read relay:work offline_access");
    assert.equal(beyondGrant.status, 400);
    assert.equal((await beyondGrant.json()).error, "invalid_scope");
    assert.equal(get("SELECT used_at FROM oauth_tokens WHERE token_hash=?", hash(readOnlyTokens.refresh_token)).used_at, null);
  });

  await check("refresh intersects live roles and issued tokens cannot regain permissions when agent roles are restored", async () => {
    const signed = await owner(identity("refresh_roles")), capabilities = seedCapabilities(signed, "refresh_roles");
    const initial = await exchangeFixtureCode(capabilities, "refresh_roles");
    run("UPDATE agents SET can_request=0,can_work=0 WHERE id=?", capabilities.agentId);
    const narrowedResponse = await refreshFixture(capabilities, initial.refresh_token, initial.scope);
    assert.equal(narrowedResponse.status, 200);
    const narrowed = await narrowedResponse.json();
    assert.deepEqual(scopeSet(narrowed.scope), ["offline_access", "relay:read"], "Issued scope intersects the original request with current roles");
    assert.deepEqual(scopeSet((await accessActor(narrowed.access_token)).scopes), scopeSet(narrowed.scope));
    run("UPDATE agents SET can_request=1,can_work=1 WHERE id=?", capabilities.agentId);
    assert.deepEqual(scopeSet((await accessActor(narrowed.access_token)).scopes), scopeSet(narrowed.scope), "Role restoration cannot expand an already-issued access token");
    const expansion = await refreshFixture(capabilities, narrowed.refresh_token, initial.scope);
    assert.equal(expansion.status, 400, "Role restoration cannot expand a narrowed refresh chain");
    assert.equal((await expansion.json()).error, "invalid_scope");
    const continuedResponse = await refreshFixture(capabilities, narrowed.refresh_token);
    assert.equal(continuedResponse.status, 200);
    const continued = await continuedResponse.json();
    assert.deepEqual(scopeSet(continued.scope), scopeSet(narrowed.scope));
    assert.deepEqual(scopeSet((await accessActor(continued.access_token)).scopes), scopeSet(narrowed.scope));
    await assertAllowed(unaffected);
  });

  await check("a database failure partway through token issuance rolls back refresh consumption and permits the same-token retry", async () => {
    const signed = await owner(identity("rotation_rollback")), capabilities = seedCapabilities(signed, "rotation_rollback");
    const initial = await exchangeFixtureCode(capabilities, "rotation_rollback");
    const tokenCount = get("SELECT COUNT(*) AS n FROM oauth_tokens WHERE grant_id=?", capabilities.grantId).n;
    let tokenInserts = 0;
    statementRunHook = async (sql) => {
      if (/^INSERT INTO oauth_tokens/.test(sql.trim()) && ++tokenInserts === 2) throw new Error("Synthetic failure before refresh-token insert");
    };
    try {
      const failed = await refreshFixture(capabilities, initial.refresh_token);
      assert.equal(failed.status, 503);
      assert.equal(tokenInserts, 2, "Fixture interrupts a real rotation after the access insert but before the refresh insert");
    } finally { statementRunHook = null; }
    assert.equal(get("SELECT used_at FROM oauth_tokens WHERE token_hash=?", hash(initial.refresh_token)).used_at, null, "Transactional rollback restores the original refresh capability");
    assert.equal(get("SELECT revoked_at FROM oauth_grants WHERE id=?", capabilities.grantId).revoked_at, null);
    assert.equal(get("SELECT COUNT(*) AS n FROM oauth_tokens WHERE grant_id=?", capabilities.grantId).n, tokenCount, "The partial access token cannot persist");
    assert.ok(await accessActor(initial.access_token));
    const retried = await refreshFixture(capabilities, initial.refresh_token);
    assert.equal(retried.status, 200);
    assert.ok((await retried.json()).refresh_token);
    assert.ok(get("SELECT used_at FROM oauth_tokens WHERE token_hash=?", hash(initial.refresh_token)).used_at);
  });

  await check("verified refresh costs one essential operation, guesses cost no normal budget, and a budget denial preserves the credential", async () => {
    const signed = await owner(identity("refresh_budget")), capabilities = seedCapabilities(signed, "refresh_budget");
    const settings = { ...env, RESOURCE_WORKSPACE_DAILY_OPERATIONS: "2", RESOURCE_WORKSPACE_MONTHLY_OPERATIONS: "100", RESOURCE_ESSENTIAL_RESERVE_PERCENT: "50" };
    const initial = await exchangeFixtureCode(capabilities, "refresh_budget", settings);
    const normalLedger = () => sqlite.prepare("SELECT * FROM resource_operation_budgets ORDER BY scope_type,scope_id").all();
    const beforeInvalid = normalLedger();
    const invalid = await refreshFixture(capabilities, "refresh_synthetic_nonexistent_budget_guess", undefined, settings);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, "invalid_grant");
    assert.deepEqual(normalLedger(), beforeInvalid, "Anonymous refresh guesses cannot spend the authenticated operation ledger");
    assert.equal(get("SELECT day_used FROM resource_operation_budgets WHERE scope_type='workspace' AND scope_id=?", signed.workspace.id).day_used, 1);
    const globalBefore = get("SELECT day_used FROM resource_operation_budgets WHERE scope_type='global' AND scope_id='service'").day_used;
    const admitted = await refreshFixture(capabilities, initial.refresh_token, undefined, settings);
    assert.equal(admitted.status, 200, "Refresh can use the essential reserve after ordinary allowance is exhausted");
    const tokens = await admitted.json();
    assert.equal(get("SELECT day_used FROM resource_operation_budgets WHERE scope_type='workspace' AND scope_id=?", signed.workspace.id).day_used, 2, "A valid refresh costs exactly one workspace operation");
    assert.equal(get("SELECT day_used FROM resource_operation_budgets WHERE scope_type='global' AND scope_id='service'").day_used, globalBefore + 1, "A valid refresh costs exactly one global operation");
    const beforeDenial = normalLedger();
    const denied = await refreshFixture(capabilities, tokens.refresh_token, undefined, settings);
    assert.equal(denied.status, 429);
    assert.equal((await denied.json()).error, "workspace_budget_exhausted");
    assert.equal(get("SELECT used_at FROM oauth_tokens WHERE token_hash=?", hash(tokens.refresh_token)).used_at, null, "Budget exhaustion must not consume a refresh credential");
    assert.equal(get("SELECT revoked_at FROM oauth_grants WHERE id=?", capabilities.grantId).revoked_at, null);
    assert.deepEqual(normalLedger(), beforeDenial, "Budget rejection cannot spend either counter");
    const recovered = await refreshFixture(capabilities, tokens.refresh_token, undefined, { ...settings, RESOURCE_WORKSPACE_DAILY_OPERATIONS: "3" });
    assert.equal(recovered.status, 200, "The same credential works once operation capacity is available");
    assert.ok((await recovered.json()).refresh_token);
  });

  await check("deleted local Google/dev identities cannot reset their hosted workspace until the hashed signup cooldown expires", async () => {
    const localBase = "http://127.0.0.1:8787", email = "cooldown-owner@example.test";
    const localEnv = { ...env, AUTH_PROVIDER: "google", ALLOW_DEV_AUTH: "true", PUBLIC_URL: localBase };
    const login = () => handle(new Request(localBase + "/auth/dev", { method: "POST", headers: { "content-type": "application/json", Origin: localBase }, body: JSON.stringify({ email }) }), localEnv);
    const sessionFrom = async (response) => {
      const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
      assert.ok(cookie);
      return (await handle(new Request(localBase + "/auth/session", { headers: { Cookie: cookie } }), localEnv)).json();
    };
    const first = await login();
    assert.equal(first.status, 200);
    const original = await sessionFrom(first);
    assert.equal(original.authenticated, true);
    const expectedHash = hash(JSON.stringify(["dev", "local", "dev:" + email]));
    const deletedAt = Date.now();
    await auth.deleteHumanAccount(localEnv, original.user.id, original.workspace.id);
    assert.equal(get("SELECT 1 FROM users WHERE id=?", original.user.id), undefined);
    assert.equal(get("SELECT 1 FROM workspaces WHERE id=?", original.workspace.id), undefined);
    const cooldown = get("SELECT identity_hash,expires_at FROM identity_signup_cooldowns WHERE identity_hash=?", expectedHash);
    assert.ok(cooldown, "Deletion retains only the hashed identity needed to prevent workspace reset abuse");
    assert.equal(cooldown.identity_hash.length, 64);
    assert.ok(!JSON.stringify(cooldown).includes(email));
    assert.ok(cooldown.expires_at >= deletedAt + 30 * 86400000 - 1000, "Default signup cooldown is at least 30 days");
    assert.ok(cooldown.expires_at <= Date.now() + 30 * 86400000 + 1000);
    const usersAfterDelete = get("SELECT COUNT(*) AS n FROM users").n;
    const workspacesAfterDelete = get("SELECT COUNT(*) AS n FROM workspaces").n;
    const denied = await login();
    assert.equal(denied.status, 429, "Immediate account recreation cannot reset workspace quotas");
    assert.equal(get("SELECT COUNT(*) AS n FROM users").n, usersAfterDelete);
    assert.equal(get("SELECT COUNT(*) AS n FROM workspaces").n, workspacesAfterDelete);
    const originalNow = Date.now;
    try {
      Date.now = () => cooldown.expires_at + 1;
      const restored = await login();
      assert.equal(restored.status, 200);
      const recreated = await sessionFrom(restored);
      assert.equal(recreated.authenticated, true);
      assert.notEqual(recreated.user.id, original.user.id);
      assert.notEqual(recreated.workspace.id, original.workspace.id);
    } finally { Date.now = originalNow; }
  });

  const registration = (ip) => request("/oauth/register", { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ client_name: "Boundary limiter fixture", redirect_uris: ["https://client.example.test/callback"] }) });
  await check("anonymous registration exhaustion cannot spend the normal resource ledger or block valid refresh", async () => {
    const signed = await owner(identity("registration_lane")), capabilities = seedCapabilities(signed, "registration_lane");
    const existing = get("SELECT day_used,month_used FROM resource_lane_budgets WHERE lane='anonymous' AND scope_type='global' AND scope_id='service'");
    const settings = { ...env, RESOURCE_ANONYMOUS_DAILY_OPERATIONS: String((existing?.day_used ?? 0) + 1), RESOURCE_ANONYMOUS_MONTHLY_OPERATIONS: String((existing?.month_used ?? 0) + 10), RESOURCE_WORKSPACE_DAILY_OPERATIONS: "2", RESOURCE_WORKSPACE_MONTHLY_OPERATIONS: "100" };
    const initial = await exchangeFixtureCode(capabilities, "registration_lane", settings);
    const normalBefore = sqlite.prepare("SELECT * FROM resource_operation_budgets ORDER BY scope_type,scope_id").all();
    const registered = await handle(registration("192.0.2.61"), settings);
    assert.equal(registered.status, 201);
    const exhausted = await handle(registration("192.0.2.62"), settings);
    assert.equal(exhausted.status, 429);
    assert.equal((await exhausted.json()).error, "anonymous_budget_exhausted");
    assert.deepEqual(sqlite.prepare("SELECT * FROM resource_operation_budgets ORDER BY scope_type,scope_id").all(), normalBefore, "Anonymous registration spends only its separate allowance");
    assert.equal(get("SELECT day_used FROM resource_lane_budgets WHERE lane='anonymous' AND scope_type='global' AND scope_id='service'").day_used, (existing?.day_used ?? 0) + 1);
    const refreshed = await refreshFixture(capabilities, initial.refresh_token, undefined, settings);
    assert.equal(refreshed.status, 200, "Anonymous allowance exhaustion cannot prevent verified token rotation");
    assert.ok((await refreshed.json()).refresh_token);
  });

  await check("global OAuth client capacity cannot grow past 1000 and aged metadata cleanup restores registration", async () => {
    const now = Date.now(), before = get("SELECT COUNT(*) AS n FROM oauth_clients").n;
    run("WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<?) INSERT INTO oauth_clients(id,name,redirect_uris,created_at) SELECT 'capacity-client-'||n,'Synthetic capacity client','[\"https://client.example.test/callback\"]',? FROM numbers", 1000 - before, now - 31 * 86400000);
    assert.equal(get("SELECT COUNT(*) AS n FROM oauth_clients").n, 1000);
    const denied = await handle(registration("192.0.2.51"));
    assert.equal(denied.status, 429);
    assert.equal((await denied.json()).error, "client_capacity");
    assert.equal(get("SELECT COUNT(*) AS n FROM oauth_clients").n, 1000, "Registration cannot exceed the global client cap");
    await auth.cleanupAuth(env, now);
    assert.equal(get("SELECT COUNT(*) AS n FROM oauth_clients WHERE id LIKE 'capacity-client-%'").n, 0, "Old unused clients stop consuming metadata capacity");
    const registered = await handle(registration("192.0.2.52"));
    assert.equal(registered.status, 201);
    const data = await registered.json();
    assert.ok(get("SELECT 1 FROM oauth_clients WHERE id=?", data.client_id));
    await assertAllowed(unaffected);
  });

  await check("owner session capacity is bounded at 20 while existing sessions work and expired cleanup frees a slot", async () => {
    const person = identity("session_capacity"), signed = await owner(person), now = Date.now();
    run("WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<19) INSERT INTO auth_sessions(token_hash,user_id,csrf_token,created_at,expires_at,provider,provider_session_id) SELECT 'capacity-session-'||n,?,'synthetic-csrf',?,?,'clerk','capacity-provider-session-'||n FROM numbers", signed.user.id, now - 86400000, now - 1);
    assert.equal(get("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?", signed.user.id).n, 20);
    await deniedOwner(fresh(person));
    assert.equal(get("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?", signed.user.id).n, 20);
    await owner(person);
    await auth.cleanupAuth(env, now);
    assert.equal(get("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?", signed.user.id).n, 1);
    const recovered = await owner(fresh(person));
    assert.equal(recovered.workspace.id, signed.workspace.id);
    assert.equal(get("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?", signed.user.id).n, 2);
  });

  await check("token metadata caps at 4096, expired cleanup frees capacity, and valid spent refresh hashes still detect reuse", async () => {
    const signed = await owner(identity("token_capacity")), capabilities = seedCapabilities(signed, "token_capacity"), now = Date.now();
    const firstRefresh = "refresh_synthetic_capacity_first", spareRefresh = "refresh_synthetic_capacity_spare";
    for (const token of [firstRefresh, spareRefresh]) run("INSERT INTO oauth_tokens(token_hash,grant_id,kind,created_at,expires_at) VALUES (?,?,'refresh',?,?)", hash(token), capabilities.grantId, now, now + 600000);
    run("WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<4093) INSERT INTO oauth_tokens(token_hash,grant_id,kind,created_at,expires_at,used_at) SELECT 'capacity-token-'||n,?,'refresh',?,?,? FROM numbers", capabilities.grantId, now - 86400000, now + 600000, now - 1);
    const refresh = (token) => handle(request("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.53" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: capabilities.clientId, refresh_token: token, resource: base + "/mcp" }) }));
    assert.equal(get("SELECT COUNT(*) AS n FROM oauth_tokens WHERE grant_id=?", capabilities.grantId).n, 4096);
    const denied = await refresh(firstRefresh);
    assert.equal(denied.status, 429);
    assert.equal((await denied.json()).error, "token_capacity");
    assert.equal(get("SELECT COUNT(*) AS n FROM oauth_tokens WHERE grant_id=?", capabilities.grantId).n, 4096, "Capacity rejection issues neither half of an access/refresh pair");
    assert.equal(get("SELECT used_at FROM oauth_tokens WHERE token_hash=?", hash(firstRefresh)).used_at, null, "Capacity rejection must leave the valid refresh unused");
    assert.equal(get("SELECT revoked_at FROM oauth_grants WHERE id=?", capabilities.grantId).revoked_at, null, "Capacity exhaustion must not revoke the grant");
    run("UPDATE oauth_tokens SET expires_at=? WHERE token_hash LIKE 'capacity-token-%'", now - 1);
    await auth.cleanupAuth(env, Date.now());
    assert.equal(get("SELECT COUNT(*) AS n FROM oauth_tokens WHERE grant_id=?", capabilities.grantId).n, 3, "Expired refresh metadata is removed");
    assert.equal(get("SELECT used_at FROM oauth_tokens WHERE token_hash=?", hash(firstRefresh)).used_at, null);
    const issued = await refresh(firstRefresh);
    assert.equal(issued.status, 200);
    const tokens = await issued.json();
    assert.ok(tokens.access_token && tokens.refresh_token);
    assert.ok(get("SELECT used_at FROM oauth_tokens WHERE token_hash=?", hash(firstRefresh)).used_at, "A successful retry consumes the same refresh exactly once");
    await auth.cleanupAuth(env, Date.now());
    assert.ok(get("SELECT used_at FROM oauth_tokens WHERE token_hash=?", hash(firstRefresh)).used_at, "An unexpired spent refresh hash must survive cleanup for reuse detection");
    assert.equal(get("SELECT COUNT(*) AS n FROM oauth_tokens WHERE grant_id=?", capabilities.grantId).n, 5);
    assert.ok(await auth.authenticateOAuth(request("/mcp", { headers: { authorization: `Bearer ${tokens.access_token}` } }), env));
    const replay = await refresh(firstRefresh);
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error, "invalid_grant");
    assert.equal(await auth.authenticateOAuth(request("/mcp", { headers: { authorization: `Bearer ${tokens.access_token}` } }), env), null, "Refresh reuse revokes the whole grant even after cleanup and later token rotation");
    await assertAllowed(unaffected);
  });

  await check("exhausted anonymous throttles reject repeated requests without further D1 writes", async () => {
    const ip = "192.0.2.41", bucket = `register:${Math.floor(Date.now() / 3600000)}:${hash(ip)}`;
    run("INSERT INTO auth_rate_limits(bucket,count,expires_at) VALUES (?,10,?)", bucket, Date.now() + 7200000);
    const changes = get("SELECT total_changes() AS n").n, clients = get("SELECT COUNT(*) AS n FROM oauth_clients").n;
    for (let i = 0; i < 3; i++) {
      const response = await handle(registration(ip));
      assert.equal(response.status, 429);
      assert.equal((await response.json()).error, "rate_limited");
    }
    assert.equal(get("SELECT total_changes() AS n").n, changes, "Rate-limited attempts perform no SQLite writes");
    assert.equal(get("SELECT count FROM auth_rate_limits WHERE bucket=?", bucket).count, 10);
    assert.equal(get("SELECT COUNT(*) AS n FROM oauth_clients").n, clients);
  });

  await check("cheap rate limiter rejects before preparing any D1 statement", async () => {
    let prepares = 0, calls = 0;
    const settings = { ...env, DB: { ...DB, prepare(sql) { prepares++; return DB.prepare(sql); } }, RATE_LIMITER: { async limit({ key }) { calls++; assert.match(key, /^auth:register:[a-f0-9]{64}$/); return { success: false }; } } };
    const changes = get("SELECT total_changes() AS n").n;
    const response = await handle(registration("192.0.2.42"), settings);
    assert.equal(response.status, 429);
    assert.equal(calls, 1);
    assert.equal(prepares, 0, "External rate-limit rejection must avoid D1 entirely");
    assert.equal(get("SELECT total_changes() AS n").n, changes);
  });

  await check("anonymous bucket cardinality is bounded and full capacity causes zero writes", async () => {
    const count = get("SELECT COUNT(*) AS n FROM auth_rate_limits").n;
    run("WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<?) INSERT INTO auth_rate_limits(bucket,count,expires_at) SELECT 'boundary-fill-'||n,1,? FROM numbers", 10000 - count, Date.now() + 7200000);
    assert.equal(get("SELECT COUNT(*) AS n FROM auth_rate_limits").n, 10000);
    const changes = get("SELECT total_changes() AS n").n;
    const response = await handle(registration("192.0.2.43"));
    assert.equal(response.status, 429);
    assert.equal(get("SELECT total_changes() AS n").n, changes);
    assert.equal(get("SELECT COUNT(*) AS n FROM auth_rate_limits").n, 10000);
  });

  console.log(`\n${passed} auth boundary security regressions passed (migrated SQLite, signed Clerk fixtures, no external network).`);
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
  await rm(temporary, { recursive: true, force: true });
}
