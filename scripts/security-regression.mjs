#!/usr/bin/env node
// Security regressions use synthetic fixtures on a disposable hosted relay.
import { createHarness, assert, eq, accepted, denied, toolText, pause } from "./hosted-e2e.mjs";
import { createHash, randomBytes } from "node:crypto";

const h = createHarness("Hosted security regression");
let alice, bob, aSender, aWorker, aOther, bSender, bWorker, privateJob, privateClaim;
let oauthClient;
const redirectUri = "http://127.0.0.1:9989/callback";
const form = (path, values, session) => h.req("POST", path, { session, raw: new URLSearchParams(values).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });

async function consent(session, agent, scope = "relay:read relay:send relay:work offline_access", overrides = {}) {
  const verifier = randomBytes(48).toString("base64url");
  const parameters = { client_id: oauthClient, redirect_uri: redirectUri, response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", scope, resource: h.base + "/mcp", state: `state-${h.run}`, ...overrides };
  const page = await h.req("GET", `/oauth/authorize?${new URLSearchParams(parameters)}`, { session });
  accepted(page, "OAuth consent page");
  const requestId = page.text.match(/name="request_id" value="([^"]+)"/)?.[1];
  assert(requestId, "Consent page contains an expiring request identifier");
  h.secrets.push(requestId, verifier);
  const response = await form("/oauth/authorize", { request_id: requestId, csrf_token: session.csrfToken, agent_id: agent.id, decision: "allow" }, session);
  accepted(response, "approve OAuth connection", [302, 303]);
  const callback = new URL(response.headers.get("location"));
  eq(callback.origin + callback.pathname, redirectUri, "OAuth returns only to registered redirect URI");
  eq(callback.searchParams.get("state"), parameters.state, "OAuth state round trip");
  eq(callback.searchParams.get("iss"), h.base, "OAuth response issuer");
  const code = callback.searchParams.get("code");
  assert(code, "OAuth approval returns an authorization code");
  h.secrets.push(code);
  return { verifier, code, parameters };
}

async function exchange(authorization, changes = {}) {
  const response = await form("/oauth/token", { grant_type: "authorization_code", client_id: oauthClient, redirect_uri: redirectUri, code: authorization.code, code_verifier: authorization.verifier, resource: h.base + "/mcp", ...changes });
  if (response.data?.access_token) h.secrets.push(response.data.access_token, response.data.refresh_token);
  return response;
}

try {
  await h.test("unadmitted email cannot use development sign-in", async () => {
    denied(await h.req("POST", "/auth/dev", { body: { email: "not-in-beta@example.test" } }), "beta admission", [403]);
  });
  await h.test("anonymous and legacy admin credentials cannot enter hosted administration", async () => {
    for (const path of ["/v1/admin/agents", "/v1/admin/overview", "/v1/events", "/v1/jobs"]) {
      denied(await h.req("GET", path), `anonymous ${path}`, [401, 403]);
      denied(await h.req("GET", path, { token: process.env.ADMIN_TOKEN || "dev-admin-token" }), `legacy owner credential ${path}`, [401, 403]);
    }
  });
  await h.test("security fixtures have independent authenticated identities", async () => {
    alice = await h.login("alice@example.test");
    bob = await h.login("bob@example.test");
    aSender = await h.addAgent(alice, "security-sender", { can_work: false });
    aWorker = await h.addAgent(alice, "security-worker");
    aOther = await h.addAgent(alice, "security-other");
    bSender = await h.addAgent(bob, "security-sender", { can_work: false });
    bWorker = await h.addAgent(bob, "security-worker");
    const response = await h.job(aSender, aWorker, "Private fixture");
    accepted(response, "private fixture", [201]);
    privateJob = response.data.job;
    const next = await h.next(aWorker);
    eq(next.data.job.id, privateJob.id, "private fixture claim");
    privateClaim = next.data.claim_id;
    h.secrets.push(privateClaim);
  });
  await h.test("browser writes require the session's CSRF token", async () => {
    const body = { id: aWorker.id, name: "Must not change" };
    denied(await h.admin(alice, "POST", "/v1/admin/agents", body, { csrf: false }), "missing CSRF", [403]);
    denied(await h.admin(alice, "POST", "/v1/admin/agents", body, { csrf: "invalid-token" }), "incorrect CSRF", [403]);
    denied(await h.admin(alice, "POST", "/v1/admin/agents", body, { csrf: bob.csrfToken }), "another session's CSRF", [403]);
    denied(await h.admin(alice, "POST", "/v1/admin/agents", body, { headers: { origin: "https://attacker.invalid" } }), "cross-origin request", [403]);
    const agents = await h.admin(alice, "GET", "/v1/admin/agents");
    eq(agents.data.agents.find((agent) => agent.id === aWorker.id).name, aWorker.name, "Rejected mutations did not change connection");
  });
  await h.test("worker credentials cannot perform owner mutations", async () => {
    denied(await h.req("DELETE", `/v1/admin/agents/${aOther.id}`, { token: aWorker.token }), "worker disconnecting another connection", [403]);
    denied(await h.req("GET", `/v1/admin/agents/${aWorker.id}/setup`, { token: aWorker.token }), "worker reading setup credentials", [403]);
  });
  await h.test("workspace IDs from headers and query strings do not grant access", async () => {
    const response = await h.req("GET", `/v1/admin/overview?workspace_id=${encodeURIComponent(alice.workspace.id)}`, { session: bob, headers: { "x-workspace-id": alice.workspace.id, "x-user-id": alice.user.id, "x-user-email": "alice@example.test" } });
    accepted(response, "spoofed workspace listing");
    assert(!response.text.includes(privateJob.id) && !response.text.includes(aWorker.id), "Server must derive tenant from the authenticated session");
    denied(await h.req("GET", "/v1/admin/overview", { headers: { "x-workspace-id": alice.workspace.id, "x-user-id": alice.user.id, "x-user-email": "alice@example.test" } }), "unauthenticated identity headers", [401, 403]);
  });
  await h.test("workspace settings cannot raise service budgets or reassign tenancy", async () => {
    for (const body of [{ connection_limit: 1000 }, { daily_job_limit: 1000000 }, { workspace_id: bob.workspace.id }, { retention_days: 31 }]) {
      denied(await h.admin(alice, "PATCH", "/v1/admin/workspace", body), "forbidden workspace setting", [400]);
    }
    const settings = await h.admin(alice, "GET", "/v1/admin/workspace");
    eq(settings.data.workspace.id, alice.workspace.id, "Workspace identity unchanged");
    eq(settings.data.limits.connections, 5, "Service connection budget unchanged");
  });
  await h.test("another workspace cannot read, mutate, pair, or disconnect a connection", async () => {
    denied(await h.admin(bob, "GET", `/v1/admin/agents/${aWorker.id}/setup`), "cross-workspace setup", [404]);
    denied(await h.admin(bob, "POST", `/v1/admin/agents/${aWorker.id}/pairing`, {}), "cross-workspace pairing", [404]);
    denied(await h.admin(bob, "DELETE", `/v1/admin/agents/${aWorker.id}`), "cross-workspace disconnect", [404]);
    denied(await h.admin(bob, "POST", "/v1/admin/agents", { id: aWorker.id, name: "Stolen connection", rotate_token: true }), "cross-workspace agent update", [400, 404]);
    eq((await h.req("GET", "/v1/me", { token: aWorker.token })).data.id, aWorker.id, "Victim credential is unchanged");
  });
  await h.test("cross-workspace task IDs cannot be read, canceled, or used as parents", async () => {
    for (const identity of [{ token: bSender.token }, { session: bob }]) {
      denied(await h.req("GET", `/v1/jobs/${privateJob.id}?full=1`, identity), "cross-workspace task read", [404]);
      denied(await h.req("POST", `/v1/jobs/${privateJob.id}/cancel`, { ...identity, body: {} }), "cross-workspace cancellation", [404]);
    }
    denied(await h.job(bSender, bWorker, "Forged parent", { parent_id: privateJob.id }), "cross-workspace parent reference", [400, 404]);
    denied(await h.job(bSender, aWorker, "Forged target"), "cross-workspace destination", [400, 404]);
    const mcp = await h.tool(bSender, "get_job", { job_id: privateJob.id });
    eq(mcp.isError, true, "MCP cross-workspace lookup rejected");
    assert(!toolText(mcp).includes(privateJob.goal), "MCP denial does not include private context");
  });
  await h.test("workers cannot forge requester or tenant fields in handoffs", async () => {
    denied(await h.job(bSender, bWorker, "Forged sender", { from: aSender.id }), "forged requester", [400]);
    denied(await h.job(bSender, bWorker, "Forged tenant", { workspace_id: alice.workspace.id }), "forged tenant", [400]);
    denied(await h.job(bSender, bWorker, "Forged callback", { reply_to: "https://attacker.invalid/capture" }), "unapproved callback", [400]);
  });
  await h.test("a stolen claim cannot be used by another worker via HTTP or MCP", async () => {
    for (const worker of [aOther, bWorker]) {
      denied(await h.submit(worker, privateClaim, { summary: "Forged result" }), "foreign HTTP claim", [403, 404, 409]);
      for (const [name, args] of [
        ["submit_result", { result: "## Summary\nForged result" }],
        ["ask_question", { question: "Forged question" }],
        ["give_up", { reason: "Forged failure" }],
      ]) {
        const result = await h.tool(worker, name, { claim_id: privateClaim, ...args });
        eq(result.isError, true, `Foreign MCP ${name} rejected`);
      }
    }
    const state = await h.req("GET", `/v1/jobs/${privateJob.id}`, { token: aSender.token });
    eq(state.data.job.status, "claimed", "Denied claim use leaves task in progress");
    accepted(await h.submit(aWorker, privateClaim), "Actual worker can finish");
  });
  await h.test("hosted credentials and claim links cannot authenticate through URLs", async () => {
    denied(await h.req("GET", `/v1/me?key=${encodeURIComponent(aWorker.token)}`), "query-string agent credential", [401]);
    denied(await h.req("POST", `/mcp/${encodeURIComponent(aWorker.token)}`, { body: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), "path MCP credential", [401, 404]);
    denied(await h.req("POST", `/mcp?key=${encodeURIComponent(aWorker.token)}`, { body: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), "query-string MCP credential", [401]);
    denied(await h.req("POST", `/v1/submit/${privateClaim}`, { body: { summary: "URL claim replay" } }), "legacy claim submission URL", [400, 401, 404]);
    denied(await h.req("GET", `/w/${privateClaim}`), "legacy browser claim URL", [404]);
    denied(await h.req("POST", "/v1/submit", { headers: { "x-claim-token": privateClaim }, body: { summary: "Uncredentialed submission" } }), "claim without connection credential", [401]);
  });
  await h.test("OAuth discovery advertises this resource and requires header authentication", async () => {
    const resource = await h.req("GET", "/.well-known/oauth-protected-resource/mcp");
    accepted(resource, "protected resource discovery");
    eq(resource.data.resource, h.base + "/mcp", "protected resource identity");
    eq(resource.data.bearer_methods_supported.join(","), "header", "only header bearer authentication");
    const server = await h.req("GET", "/.well-known/oauth-authorization-server");
    accepted(server, "authorization server discovery");
    eq(server.data.issuer, h.base, "authorization issuer");
    assert(server.data.code_challenge_methods_supported.includes("S256"), "S256 PKCE advertised");
    const unauthenticated = await h.rpc(null, "tools/list");
    eq(unauthenticated.status, 401, "MCP starts authentication");
    assert(unauthenticated.headers.get("www-authenticate")?.includes("oauth-protected-resource"), "MCP points clients to resource discovery");
  });
  await h.test("OAuth public client registration rejects unsafe redirect URIs", async () => {
    const registration = await h.req("POST", "/oauth/register", { body: { client_name: `Local security tests ${h.run}`, redirect_uris: [redirectUri], token_endpoint_auth_method: "none" } });
    accepted(registration, "register local OAuth client", [201]);
    oauthClient = registration.data.client_id;
    assert(oauthClient, "Registration returns client identity");
    for (const redirect of ["javascript:alert(1)", "http://attacker.invalid/callback", "https://user:pass@example.test/callback", "https://example.test/callback#fragment"]) {
      denied(await h.req("POST", "/oauth/register", { body: { redirect_uris: [redirect], token_endpoint_auth_method: "none" } }), "unsafe OAuth redirect", [400]);
    }
  });
  await h.test("OAuth authorization requires PKCE, exact redirect, scope, and resource", async () => {
    const valid = { client_id: oauthClient, redirect_uri: redirectUri, response_type: "code", code_challenge: "a".repeat(43), code_challenge_method: "S256", scope: "relay:read", resource: h.base + "/mcp" };
    for (const override of [{ code_challenge_method: "plain" }, { code_challenge: "" }, { redirect_uri: redirectUri + "/other" }, { resource: "https://attacker.invalid/mcp" }, { scope: "relay:admin" }]) {
      denied(await h.req("GET", `/oauth/authorize?${new URLSearchParams({ ...valid, ...override })}`, { session: alice }), "invalid OAuth authorization", [400]);
    }
  });
  await h.test("OAuth consent cannot select a connection in another workspace", async () => {
    const parameters = { client_id: oauthClient, redirect_uri: redirectUri, response_type: "code", code_challenge: "a".repeat(43), code_challenge_method: "S256", scope: "relay:read", resource: h.base + "/mcp" };
    const page = await h.req("GET", `/oauth/authorize?${new URLSearchParams(parameters)}`, { session: bob });
    accepted(page, "Bob's consent page");
    assert(!page.text.includes(aWorker.id), "Alice's connection must not appear in Bob's consent options");
    const requestId = page.text.match(/name="request_id" value="([^"]+)"/)?.[1];
    assert(requestId, "Consent request identifier exists");
    denied(await form("/oauth/authorize", { request_id: requestId, csrf_token: bob.csrfToken, agent_id: aWorker.id, decision: "allow" }, bob), "forged consent connection", [403]);
    denied(await form("/oauth/authorize", { request_id: requestId, csrf_token: alice.csrfToken, agent_id: aWorker.id, decision: "allow" }, alice), "consent request stolen across sessions", [400, 403]);
  });
  await h.test("OAuth code exchange binds PKCE and resource and grants only consented scopes", async () => {
    const authorization = await consent(alice, aWorker, "relay:read offline_access");
    denied(await exchange(authorization, { code_verifier: "b".repeat(64) }), "incorrect verifier", [400]);
    denied(await exchange(authorization, { resource: "https://attacker.invalid/mcp" }), "incorrect resource", [400]);
    const tokens = await exchange(authorization);
    accepted(tokens, "valid OAuth exchange");
    assert(tokens.data.refresh_token, "Offline consent grants refresh token");
    const client = { token: tokens.data.access_token };
    const listing = await h.rpc(client, "tools/list");
    accepted(listing, "read-scoped MCP listing");
    const names = listing.data.result.tools.map((tool) => tool.name);
    assert(names.includes("get_job") && !names.includes("send_job") && !names.includes("submit_result"), "Tool discovery respects read-only scope");
    const mutation = await h.rpc(client, "tools/call", { name: "send_job", arguments: { to: aOther.id, type: "task", title: "Forbidden scoped send", task: "Must not execute." } });
    assert(mutation.data?.error || mutation.data?.result?.isError, "A hidden mutation tool cannot bypass scope checks");
    denied(await exchange(authorization), "authorization code replay", [400]);
    eq((await h.rpc(client, "tools/list")).status, 401, "Code replay revokes the affected grant");
  });
  await h.test("OAuth refresh rotation detects replay and revokes the grant", async () => {
    const tokens = await exchange(await consent(alice, aWorker));
    accepted(tokens, "OAuth fixture exchange");
    const values = { grant_type: "refresh_token", client_id: oauthClient, refresh_token: tokens.data.refresh_token, resource: h.base + "/mcp" };
    const rotated = await form("/oauth/token", values);
    accepted(rotated, "OAuth refresh");
    h.secrets.push(rotated.data.access_token, rotated.data.refresh_token);
    assert(rotated.data.refresh_token !== tokens.data.refresh_token, "Refresh token rotates");
    accepted(await h.rpc({ token: rotated.data.access_token }, "tools/list"), "rotated access token");
    denied(await form("/oauth/token", values), "refresh token replay", [400]);
    eq((await h.rpc({ token: rotated.data.access_token }, "tools/list")).status, 401, "Refresh replay revokes the grant's newer access token");
  });
  await h.test("OAuth explicit revocation invalidates access and refresh credentials", async () => {
    const tokens = await exchange(await consent(alice, aWorker));
    accepted(tokens, "revocation fixture exchange");
    accepted(await form("/oauth/revoke", { client_id: oauthClient, token: tokens.data.refresh_token }), "revoke OAuth grant");
    eq((await h.rpc({ token: tokens.data.access_token }, "tools/list")).status, 401, "revoked access token");
    denied(await form("/oauth/token", { grant_type: "refresh_token", client_id: oauthClient, refresh_token: tokens.data.refresh_token, resource: h.base + "/mcp" }), "revoked refresh token", [400]);
  });
  await h.test("send-only settings saves preserve OAuth access, refresh and connection credentials", async () => {
    const tokens = await exchange(await consent(alice, aSender));
    accepted(tokens, "send-only OAuth exchange");
    for (const name of [`Sender renamed ${h.run}`, `Sender renamed ${h.run}`]) {
      const saved = await h.admin(alice, "POST", "/v1/admin/agents", { id: aSender.id, name, can_request: true, can_work: false });
      accepted(saved, "save send-only settings");
      assert(!saved.data.pairing && !saved.data.token, "Ordinary saves do not issue pairing codes or credentials");
      accepted(await h.rpc({ token: tokens.data.access_token }, "tools/list"), "OAuth still works after settings save");
      accepted(await h.req("GET", "/v1/me", { token: aSender.token }), "paired credential still works");
    }
    const refreshed = await form("/oauth/token", { grant_type: "refresh_token", client_id: oauthClient, refresh_token: tokens.data.refresh_token, resource: h.base + "/mcp" });
    accepted(refreshed, "refresh after send-only settings save");
    h.secrets.push(refreshed.data.access_token, refreshed.data.refresh_token);
    accepted(await h.rpc({ token: refreshed.data.access_token }, "tools/list"), "refreshed access after settings save");
  });
  await h.test("disabling and restoring Receive tasks does not revive old claims or revoke OAuth", async () => {
    const tokens = await exchange(await consent(alice, aOther));
    accepted(tokens, "permission fixture OAuth exchange");
    const client = { token: tokens.data.access_token };
    const fixture = await h.job(aSender, aOther, "Permission fencing fixture");
    accepted(fixture, "permission fencing fixture", [201]);
    const work = await h.next(aOther);
    eq(work.data.job.id, fixture.data.job.id, "permission fixture claim");
    h.secrets.push(work.data.claim_id);
    accepted(await h.admin(alice, "POST", "/v1/admin/agents", { id: aOther.id, can_work: false }), "disable reception");
    const narrowed = await h.rpc(client, "tools/list");
    accepted(narrowed, "OAuth remains authenticated while work is disabled");
    assert(!narrowed.data.result.tools.some(tool => tool.name === "get_next_job" || tool.name === "submit_result"), "Disabled work tools disappear");
    denied(await h.submit(aOther, work.data.claim_id), "claim while reception is disabled", [403, 404, 409]);
    accepted(await h.admin(alice, "POST", "/v1/admin/agents", { id: aOther.id, can_work: true }), "restore reception");
    const restored = await h.rpc(client, "tools/list");
    accepted(restored, "previously consented work scope returns");
    assert(restored.data.result.tools.some(tool => tool.name === "get_next_job"), "Previously consented work scope is restored");
    for (const body of [{ summary: "Revoked claim must not complete" }, { status: "failed", error: "Revoked claim must not fail" }, { status: "input_required", question: "Revoked claim must not ask" }]) {
      denied(await h.submit(aOther, work.data.claim_id, body), "old claim after restoring reception", [403, 404, 409]);
    }
    denied(await h.req("POST", "/v1/heartbeat", { token: aOther.token, headers: { "x-claim-token": work.data.claim_id } }), "old heartbeat after restoring reception", [403, 404, 409]);
    const resumed = await h.next(aOther);
    eq(resumed.data.job.id, fixture.data.job.id, "fresh receipt can resume the current lease");
    assert(resumed.data.claim_id !== work.data.claim_id, "Resumed lease has a new claim");
    h.secrets.push(resumed.data.claim_id);
    accepted(await h.submit(aOther, resumed.data.claim_id), "fresh claim completes");
  });
  await h.test("new Receive tasks permission requires fresh OAuth consent", async () => {
    const tokens = await exchange(await consent(alice, aSender));
    accepted(tokens, "send-only consent");
    accepted(await h.admin(alice, "POST", "/v1/admin/agents", { id: aSender.id, can_work: true, poll_minutes: null }), "enable on-demand reception");
    const original = await h.rpc({ token: tokens.data.access_token }, "tools/list");
    accepted(original, "original send-only grant remains usable");
    assert(!original.data.result.tools.some(tool => tool.name === "get_next_job"), "Settings cannot widen consented scope");
    const replacement = await exchange(await consent(alice, aSender));
    accepted(replacement, "fresh consent for added permission");
    const expanded = await h.rpc({ token: replacement.data.access_token }, "tools/list");
    accepted(expanded, "new work grant");
    assert(expanded.data.result.tools.some(tool => tool.name === "get_next_job"), "Fresh consent includes enabled work permission");
    accepted(await h.admin(alice, "POST", "/v1/admin/agents", { id: aSender.id, can_work: false }), "restore sender-only fixture");
  });
  await h.test("opening setup and saving settings preserve an outstanding pairing code", async () => {
    const pairing = await h.admin(alice, "POST", `/v1/admin/agents/${aOther.id}/pairing`, {});
    accepted(pairing, "create pending pairing code");
    h.secrets.push(pairing.data.code);
    for (const method of ["GET", "POST"]) {
      const setup = await h.admin(alice, method, `/v1/admin/agents/${aOther.id}/setup`, method === "POST" ? {} : undefined);
      accepted(setup, "read setup without issuing a code");
      assert(setup.data.guide && !setup.data.pairing && !setup.text.includes(pairing.data.code), "Setup reads return a guide without recovering or replacing the code");
    }
    const saved = await h.admin(alice, "POST", "/v1/admin/agents", { id: aOther.id, name: `Worker renamed ${h.run}`, can_work: true });
    accepted(saved, "ordinary settings save");
    assert(!saved.data.pairing, "Settings saves do not create a pairing code");
    const redeemed = await h.req("POST", "/v1/pair", { body: { code: pairing.data.code } });
    accepted(redeemed, "original copied code still redeems");
    eq(redeemed.data.token, aOther.token, "Read and save preserve the existing connection credential");
  });
  await h.test("explicit pairing replacement invalidates only that connection's previous code", async () => {
    const first = await h.admin(alice, "POST", `/v1/admin/agents/${aOther.id}/pairing`, {});
    const second = await h.admin(alice, "POST", `/v1/admin/agents/${aOther.id}/pairing`, {});
    accepted(first, "initial explicit code"); accepted(second, "replacement explicit code");
    h.secrets.push(first.data.code, second.data.code);
    denied(await h.req("POST", "/v1/pair", { body: { code: first.data.code } }), "replaced code", [400]);
    accepted(await h.req("POST", "/v1/pair", { body: { code: second.data.code } }), "replacement code");
  });
  await h.test("pairing code consumption is atomic under concurrent redemption", async () => {
    const pair = await h.admin(alice, "POST", `/v1/admin/agents/${aOther.id}/pairing`, {});
    accepted(pair, "create concurrent pairing", [200, 201]);
    h.secrets.push(pair.data.code);
    const results = await Promise.all([h.req("POST", "/v1/pair", { body: { code: pair.data.code } }), h.req("POST", "/v1/pair", { body: { code: pair.data.code } })]);
    eq(results.filter((response) => response.status === 200).length, 1, "Exactly one pairing redemption succeeds");
    const success = results.find((response) => response.status === 200);
    h.secrets.push(success.data.token);
    aOther.token = success.data.token;
    denied(results.find((response) => response.status !== 200), "losing pairing redemption");
  });
  await h.test("token rotation revokes old authentication and outstanding claims", async () => {
    const fixture = await h.job(aSender, aOther, "Rotation fixture");
    accepted(fixture, "rotation fixture", [201]);
    const work = await h.next(aOther);
    eq(work.data.job.id, fixture.data.job.id, "rotation fixture claim");
    const oldToken = aOther.token;
    const oldClaim = work.data.claim_id;
    h.secrets.push(oldClaim);
    const tokens = await exchange(await consent(alice, aOther));
    accepted(tokens, "rotation OAuth fixture");
    const pending = await h.admin(alice, "POST", `/v1/admin/agents/${aOther.id}/pairing`, {});
    accepted(pending, "rotation pending pairing fixture");
    h.secrets.push(pending.data.code);
    accepted(await h.admin(alice, "POST", "/v1/admin/agents", { id: aOther.id, rotate_token: true }), "rotate worker credential");
    denied(await h.req("GET", "/v1/me", { token: oldToken }), "old worker credential", [401]);
    eq((await h.rpc({ token: tokens.data.access_token }, "tools/list")).status, 401, "Rotation invalidates old OAuth access");
    denied(await form("/oauth/token", { grant_type: "refresh_token", client_id: oauthClient, refresh_token: tokens.data.refresh_token, resource: h.base + "/mcp" }), "OAuth refresh after credential rotation", [400]);
    denied(await h.req("POST", "/v1/pair", { body: { code: pending.data.code } }), "pairing before credential rotation", [400]);
    const pairing = await h.admin(alice, "POST", `/v1/admin/agents/${aOther.id}/pairing`, {});
    const redeemed = await h.req("POST", "/v1/pair", { body: { code: pairing.data.code } });
    accepted(redeemed, "new worker pairing");
    aOther.token = redeemed.data.token;
    h.secrets.push(aOther.token, pairing.data.code);
    denied(await h.submit(aOther, oldClaim, { summary: "Old claim reused after rotation" }), "claim revoked by rotation", [403, 404, 409]);
    accepted(await h.req("POST", `/v1/jobs/${fixture.data.job.id}/cancel`, { token: aSender.token, body: {} }), "cancel rotation fixture");
  });
  await h.test("expired claims cannot submit failures or questions over a newer lease", async () => {
    const fixture = await h.job(aSender, aWorker, "Lease fencing fixture", { lease_seconds: 1, max_attempts: 3 });
    accepted(fixture, "short lease fixture", [201]);
    const first = await h.next(aWorker);
    eq(first.data.job.id, fixture.data.job.id, "first lease");
    const staleClaim = first.data.claim_id;
    h.secrets.push(staleClaim);
    await pause(1250);
    const second = await h.next(aWorker);
    eq(second.data.job.id, fixture.data.job.id, "second lease");
    eq(second.data.job.attempts, 2, "expired attempt requeued");
    assert(second.data.claim_id !== staleClaim, "New attempt has a new claim");
    for (const body of [{ status: "failed", error: "Late failure" }, { status: "needs_input", question: "Late question" }, { summary: "Late completion" }]) {
      denied(await h.submit(aWorker, staleClaim, body), "expired claim cannot mutate task", [403, 404, 409]);
    }
    accepted(await h.submit(aWorker, second.data.claim_id), "current lease completes");
    const state = await h.req("GET", `/v1/jobs/${fixture.data.job.id}`, { token: aSender.token });
    eq(state.data.job.status, "completed", "only current lease completed task");
  });
  await h.test("deleted connection's tokens, claims, and pending pairing codes are revoked", async () => {
    const fixture = await h.job(aSender, aOther, "Deleted worker fixture");
    accepted(fixture, "deleted worker fixture", [201]);
    const claim = await h.next(aOther);
    eq(claim.data.job.id, fixture.data.job.id, "deleted worker claim");
    const pairing = await h.admin(alice, "POST", `/v1/admin/agents/${aOther.id}/pairing`, {});
    accepted(await h.admin(alice, "DELETE", `/v1/admin/agents/${aOther.id}`), "delete worker");
    denied(await h.req("GET", "/v1/me", { token: aOther.token }), "deleted worker credential", [401]);
    denied(await h.submit(aOther, claim.data.claim_id), "deleted worker claim", [401, 403, 404, 409]);
    denied(await h.req("POST", "/v1/pair", { body: { code: pairing.data.code } }), "deleted worker pairing code");
    const state = await h.req("GET", `/v1/jobs/${fixture.data.job.id}`, { token: aSender.token });
    eq(state.data.job.status, "canceled", "orphaned open task canceled");
  });
  await h.test("acknowledging an unseen future inbox cursor cannot skip results", async () => {
    const result = await h.tool(aSender, "acknowledge_results", { delivery_cursor: Number.MAX_SAFE_INTEGER });
    eq(result.isError, true, "Unseen future cursor rejected");
    assert(toolText(await h.tool(aSender, "check_inbox")).includes(privateJob.id), "Unacknowledged result is still deliverable");
  });
  await h.test("MCP rejects invalid argument shapes, unknown fields, and excessive field sizes", async () => {
    for (const [name, args] of [
      ["get_job", null],
      ["get_job", []],
      ["get_job", { job_id: privateJob.id, full: "yes" }],
      ["check_inbox", { limit: 21 }],
      ["list_agents", { workspace_id: bob.workspace.id }],
      ["send_job", { to: aWorker.id, type: "task", title: "Too long", task: "x".repeat(20001) }],
      ["send_back", { job_id: privateJob.id, feedback: "x".repeat(20001) }],
    ]) {
      const response = await h.rpc(aSender, "tools/call", { name, arguments: args });
      eq(response.data?.error?.code, -32602, `${name} invalid arguments rejected`);
    }
  });
  await h.test("MCP batch limits reject the whole batch before dispatch", async () => {
    const mutation = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_job", arguments: { to: aWorker.id, type: "task", title: `Must never execute ${h.run}`, task: "Not authorized by this invalid batch.", idempotency_key: `invalid-batch-${h.run}` } } };
    for (const body of [[], Array.from({ length: 11 }, (_, index) => ({ ...mutation, id: index + 1 }))]) {
      const response = await h.req("POST", "/mcp", { token: aSender.token, body });
      assert(response.status === 400 || response.data?.error?.code === -32600, "Invalid batch receives protocol error");
    }
    const jobs = await h.req("GET", "/v1/jobs", { token: aSender.token });
    assert(!jobs.data.jobs.some((job) => job.title === mutation.params.arguments.title), "Oversized batch executes no mutations");
  });
  await h.test("HTTP and MCP apply shared byte and nesting limits", async () => {
    const large = "x".repeat(512 * 1024 + 1);
    denied(await h.req("POST", "/v1/jobs", { token: aSender.token, body: { type: "task", to: aWorker.id, title: "Oversized", goal: large } }), "oversized HTTP payload", [413]);
    denied(await h.req("POST", "/mcp", { token: aSender.token, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_job", arguments: { task: large } } } }), "oversized MCP payload", [413]);
    let nested = {};
    for (let level = 0; level < 40; level++) nested = { nested };
    const deep = await h.rpc(aSender, "tools/call", { name: "send_job", arguments: nested });
    assert(deep.status === 400 || [-32600, -32602].includes(deep.data?.error?.code), "Deeply nested MCP payload rejected");
  });
  await h.test("webhook configuration rejects private-network destinations and URL credentials", async () => {
    for (const wake_url of ["http://127.0.0.1/callback", "https://127.0.0.1/callback", "https://[::1]/callback", "https://169.254.169.254/latest/meta-data", "https://10.0.0.1/callback", "https://user:pass@example.test/callback", "https://localhost/callback"]) {
      denied(await h.admin(alice, "POST", "/v1/admin/agents", { id: aWorker.id, wake_url }), "unsafe webhook destination", [400]);
    }
  });
  await h.test("hosted schedule cap rejects an eleventh schedule but allows existing edits", async () => {
    const schedule = (number) => ({ id: `bounded-${number}-${h.run}`, every_minutes: 1440, start_in_minutes: 60, from: aSender.id, template: { type: "task", to: aWorker.id, title: `Bounded schedule ${number}`, goal: "Acknowledge this synthetic fixture." } });
    for (let number = 1; number <= 10; number++) {
      const response = await h.admin(alice, "POST", "/v1/admin/schedules", schedule(number));
      accepted(response, `create schedule ${number}`);
      h.resources.push({ session: alice, kind: "schedules", id: response.data.schedule.id });
    }
    const excess = await h.admin(alice, "POST", "/v1/admin/schedules", schedule(11));
    denied(excess, "eleventh schedule", [429]);
    eq(excess.data.error.code, "schedule_limit", "schedule allowance enforced");
    const edited = await h.admin(alice, "POST", "/v1/admin/schedules", { ...schedule(1), every_minutes: 720 });
    accepted(edited, "edit existing schedule at allowance boundary");
    eq(edited.data.schedule.every_minutes, 720, "existing schedule changed");
    eq((await h.admin(alice, "GET", "/v1/admin/schedules")).data.schedules.length, 10, "editing does not consume another slot");
  });
  await h.test("task ancestry accepts five follow-up levels and rejects a sixth", async () => {
    const root = await h.job(aSender, aWorker, "Ancestry root");
    accepted(root, "create ancestry root", [201]);
    let parentId = root.data.job.id;
    accepted(await h.req("POST", `/v1/jobs/${parentId}/cancel`, { token: aSender.token, body: {} }), "close root fixture");
    for (let level = 1; level <= 5; level++) {
      const child = await h.job(aSender, aWorker, `Ancestry level ${level}`, { parent_id: parentId });
      accepted(child, `accept follow-up level ${level}`, [201]);
      eq(child.data.job.parent_id, parentId, "follow-up parent preserved");
      parentId = child.data.job.id;
      accepted(await h.req("POST", `/v1/jobs/${parentId}/cancel`, { token: aSender.token, body: {} }), "close follow-up fixture");
    }
    const tooDeep = await h.job(aSender, aWorker, "Ancestry level six", { parent_id: parentId });
    denied(tooDeep, "sixth follow-up level", [429]);
    eq(tooDeep.data.error.code, "task_depth", "depth rejection is distinct from queue or daily quota");
  });
  await h.test("concurrent follow-ups cannot exceed twenty-five descendants of one task", async () => {
    const root = await h.job(aSender, aWorker, "Descendant root");
    accepted(root, "create descendant root", [201]);
    const rootId = root.data.job.id;
    const close = async (jobId) => accepted(await h.req("POST", `/v1/jobs/${jobId}/cancel`, { token: aSender.token, body: {} }), "close descendant fixture");
    await close(rootId);
    for (let number = 1; number <= 24; number++) {
      const child = await h.job(aSender, aWorker, `Descendant ${number}`, { parent_id: rootId });
      accepted(child, `accept descendant ${number}`, [201]);
      await close(child.data.job.id);
    }
    const responses = await Promise.all([h.job(aSender, aWorker, "Descendant final slot A", { parent_id: rootId }), h.job(aSender, aWorker, "Descendant final slot B", { parent_id: rootId })]);
    eq(responses.filter((response) => response.status === 201).length, 1, "only the twenty-fifth descendant is admitted");
    eq(responses.filter((response) => response.status === 429).length, 1, "concurrent twenty-sixth descendant rejected");
    for (const response of responses) if (response.status === 201) await close(response.data.job.id);
    const listing = await h.req("GET", "/v1/jobs?limit=100", { token: aSender.token });
    eq(listing.data.jobs.filter((job) => job.parent_id === rootId).length, 25, "exactly twenty-five descendants persisted");
    const unrelated = await h.job(aSender, aWorker, "Independent task after descendant cap");
    accepted(unrelated, "daily and queue budgets remain available", [201]);
    await close(unrelated.data.job.id);
  });
  await h.test("deleting a broadcast worker after the final attempt fails the task", async () => {
    const worker = await h.addAgent(alice, "last-attempt", { can_request: false });
    const sent = await h.job(aSender, "*", "Final broadcast attempt", { max_attempts: 1 });
    accepted(sent, "broadcast fixture", [201]);
    const work = await h.next(worker);
    eq(work.data.job.id, sent.data.job.id, "broadcast task claimed by fixture worker");
    eq(work.data.job.attempts, 1, "final available attempt claimed");
    accepted(await h.admin(alice, "DELETE", `/v1/admin/agents/${worker.id}`), "disconnect final-attempt worker");
    const state = await h.req("GET", `/v1/jobs/${sent.data.job.id}`, { token: aSender.token });
    accepted(state, "read exhausted broadcast task");
    eq(state.data.job.status, "failed", "exhausted broadcast is terminal rather than stranded in queue");
    eq(state.data.job.lease, null, "disconnected worker lease cleared");
    assert(state.data.job.completed_at, "exhausted task has a terminal timestamp");
    let notified = false;
    let cursor;
    for (let page = 0; page < 5; page++) {
      const inbox = toolText(await h.tool(aSender, "check_inbox", cursor === undefined ? {} : { cursor }));
      if (inbox.includes(sent.data.job.id)) { notified = true; break; }
      const nextCursor = Number(inbox.match(/delivery_cursor: (\d+)/)?.[1]);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    assert(notified, "requester is notified of terminal failure");
  });
  await h.test("concurrent handoffs cannot exceed a sender's daily allowance", async () => {
    accepted(await h.admin(bob, "POST", "/v1/admin/agents", { id: bSender.id, daily_job_limit: 1 }), "configure one-handoff sender allowance");
    const responses = await Promise.all([h.job(bSender, bWorker, "Daily allowance first"), h.job(bSender, bWorker, "Daily allowance second")]);
    eq(responses.filter((response) => response.status === 201).length, 1, "Exactly one handoff admitted at allowance boundary");
    eq(responses.filter((response) => response.status === 429).length, 1, "Concurrent extra handoff rate limited");
  });
  await h.test("concurrent connection creation respects the workspace connection cap", async () => {
    const listing = await h.admin(alice, "GET", "/v1/admin/agents");
    const free = 5 - listing.data.agents.length;
    assert(free >= 0 && free <= 5, "Fixture expects a five-connection beta workspace");
    const responses = await Promise.all(Array.from({ length: free + 1 }, (_, index) => h.admin(alice, "POST", "/v1/admin/agents", { id: `cap-${index}-${h.run}`, can_request: true, can_work: false })));
    for (const response of responses) if (response.status === 201) h.resources.push({ session: alice, kind: "agents", id: response.data.agent.id });
    eq(responses.filter((response) => response.status === 201).length, free, "Only free connection slots are admitted");
    eq(responses.filter((response) => response.status === 429).length, 1, "Excess concurrent connection rejected");
    eq((await h.admin(alice, "GET", "/v1/admin/agents")).data.agents.length, 5, "Workspace never exceeds its connection cap");
  });
  await h.test("disconnecting a scheduled worker disables its orphaned schedule", async () => {
    const schedule = await h.admin(bob, "POST", "/v1/admin/schedules", { id: `orphan-${h.run}`, every_minutes: 1440, start_in_minutes: 60, from: bSender.id, template: { type: "task", to: bWorker.id, title: "Orphan fixture", goal: "Acknowledge." } });
    accepted(schedule, "create orphan fixture");
    h.resources.push({ session: bob, kind: "schedules", id: schedule.data.schedule.id });
    accepted(await h.admin(bob, "DELETE", `/v1/admin/agents/${bWorker.id}`), "disconnect scheduled worker");
    const listing = await h.admin(bob, "GET", "/v1/admin/schedules");
    const retained = listing.data.schedules.find((item) => item.id === schedule.data.schedule.id);
    assert(!retained || !retained.enabled, "Orphaned schedule is removed or disabled");
  });
  await h.test("workspace deletion confirms intent and revokes only that workspace's access", async () => {
    denied(await h.admin(bob, "DELETE", "/v1/admin/workspace", { confirmation: "not-confirmed" }), "deletion confirmation", [400]);
    accepted(await h.admin(bob, "GET", "/v1/admin/export"), "workspace survives invalid confirmation");
    accepted(await h.admin(bob, "DELETE", "/v1/admin/workspace", { confirmation: "DELETE" }), "delete synthetic Bob workspace");
    for (let index = h.resources.length - 1; index >= 0; index--) if (h.resources[index].session === bob) h.resources.splice(index, 1);
    denied(await h.admin(bob, "GET", "/v1/admin/overview"), "deleted workspace session", [401, 403]);
    denied(await h.req("GET", "/v1/me", { token: bSender.token }), "deleted workspace connection", [401]);
    eq((await h.req("GET", "/auth/session", { session: bob })).data.authenticated, false, "deleted account session invalidated");
    accepted(await h.admin(alice, "GET", "/v1/admin/overview"), "other workspace remains accessible");
  });
} finally {
  await h.cleanup();
  if (alice) await h.test("logout invalidates the old session cookie", async () => {
    accepted(await h.req("POST", "/auth/logout", { session: alice, body: {} }), "log out");
    denied(await h.admin(alice, "GET", "/v1/admin/overview"), "replay of revoked session cookie", [401, 403]);
    const response = await h.req("GET", "/auth/session", { session: alice });
    eq(response.data.authenticated, false, "old session is no longer authenticated");
  });
  h.finish();
}
