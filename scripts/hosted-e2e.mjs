#!/usr/bin/env node
// Hosted-mode integration tests. Use scripts/test-local.mjs for a disposable DB.
// Never run against a live relay unless ALLOW_REMOTE_TESTS=true is intentional.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function eq(actual, expected, message) {
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
export function accepted(response, message, statuses = [200]) {
  assert(statuses.includes(response.status), `${message}: HTTP ${response.status} (${response.data?.error?.code ?? response.data?.error ?? "unexpected response"})${response.data?.error?.message ? ` ${response.data.error.message}` : ""}`);
}
export function denied(response, message, statuses = [400, 401, 403, 404, 409]) {
  accepted(response, message, statuses);
}
export const toolText = (result) => (result?.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
export const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

export function createHarness(label) {
  const base = (process.env.RELAY_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const url = new URL(base);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  assert(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/", "RELAY_URL must be an HTTP(S) origin without credentials, query, or path");
  assert(loopback || process.env.ALLOW_REMOTE_TESTS === "true", "Refusing a non-loopback test target; use a disposable local relay or explicitly set ALLOW_REMOTE_TESTS=true");
  const run = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let passed = 0;
  const failures = [];
  const resources = [];
  const secrets = [];
  const cleanError = (error) => secrets.reduce((message, secret) => secret ? message.replaceAll(secret, "[redacted]") : message, String(error?.message ?? error)).replace(/\b(?:ar|ct|oa|rt|st)_[\w-]+/g, "[redacted]");

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ok  ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`  FAIL ${name}\n       ${cleanError(error)}`);
    }
  }

  async function req(method, path, { session, token, csrf = true, body, raw, headers = {}, redirect = "manual" } = {}) {
    assert(path.startsWith("/") && !path.startsWith("//"), "Test request paths must stay on the configured origin");
    const requestHeaders = { accept: "application/json", ...headers };
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && requestHeaders.origin === undefined) requestHeaders.origin = base;
    if (session?.cookie) requestHeaders.cookie = session.cookie;
    if (session && csrf && !["GET", "HEAD", "OPTIONS"].includes(method)) requestHeaders["x-csrf-token"] = typeof csrf === "string" ? csrf : session.csrfToken;
    if (token) requestHeaders.authorization = `Bearer ${token}`;
    let payload = raw;
    if (body !== undefined) {
      requestHeaders["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const response = await fetch(base + path, { method, headers: requestHeaders, body: payload, redirect, signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { /* HTML, SSE, and markdown may be intentional. */ }
    return { status: response.status, headers: response.headers, text, data };
  }

  async function login(email) {
    const response = await req("POST", "/auth/dev", { body: { email } });
    accepted(response, `local test login for ${email}`);
    const cookies = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie")].filter(Boolean);
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    assert(cookie, "Login must set a session cookie");
    secrets.push(cookie, ...cookies.map((value) => value.split(";")[0].split("=").slice(1).join("=")));
    const sessionResponse = await req("GET", "/auth/session", { session: { cookie } });
    accepted(sessionResponse, "read browser session");
    eq(sessionResponse.data.authenticated, true, "authenticated browser session");
    assert(sessionResponse.data.csrfToken, "Session must supply a CSRF token");
    secrets.push(sessionResponse.data.csrfToken);
    return { ...sessionResponse.data, cookie, cookieHeaders: cookies };
  }

  const admin = (session, method, path, body, options = {}) => req(method, path, { session, body, ...options });
  async function addAgent(session, handle, spec = {}) {
    const response = await admin(session, "POST", "/v1/admin/agents", {
      id: `${handle}-${run}`,
      name: `${handle} ${run}`,
      platform: "other",
      can_request: true,
      can_work: true,
      work_types: ["task", "summarize", "review"],
      ...spec,
    });
    accepted(response, `create ${handle}`, [201]);
    assert(response.data.agent.id, "Connection has a server identity");
    resources.push({ session, kind: "agents", id: response.data.agent.id });
    if (response.data.token) secrets.push(response.data.token);
    const pairing = await admin(session, "POST", `/v1/admin/agents/${response.data.agent.id}/pairing`, {});
    accepted(pairing, "issue pairing code", [200, 201]);
    assert(pairing.data.code && pairing.data.expires_at, "Pairing code has an expiry");
    secrets.push(pairing.data.code);
    const redemption = await req("POST", "/v1/pair", { body: { code: pairing.data.code } });
    accepted(redemption, "redeem pairing code");
    assert(redemption.data.token, "Pairing returns a worker credential");
    secrets.push(redemption.data.token);
    return { ...response.data.agent, token: redemption.data.token, setup: response.data.setup, guide: response.data.guide, pairing, createResponse: response };
  }

  const job = (agent, to, title, extra = {}) => req("POST", "/v1/jobs", { token: agent.token, body: { type: "task", to: to.id ?? to, title: `${title} ${run}`, goal: "Return a short acknowledgement of this harmless local integration test.", ...extra } });
  const next = (agent) => req("POST", "/v1/work/next?format=json", { token: agent.token });
  const submit = (agent, claimId, body = { summary: "Local integration test completed.", body: "Only synthetic fixture data was used." }) => req("POST", "/v1/submit", { token: agent.token, headers: { "x-claim-token": claimId }, body });

  async function rpc(agent, method, params = {}, extra = {}) {
    return req("POST", "/mcp", { token: agent?.token, body: { jsonrpc: "2.0", id: 1, method, params }, ...extra });
  }
  async function tool(agent, name, args = {}) {
    const response = await rpc(agent, "tools/call", { name, arguments: args });
    accepted(response, `MCP ${name}`);
    assert(response.data?.result, `MCP ${name} did not return a result (${response.data?.error?.code ?? "invalid response"})`);
    return response.data.result;
  }

  async function cleanup() {
    for (const resource of resources.toReversed()) {
      const response = await admin(resource.session, "DELETE", `/v1/admin/${resource.kind}/${resource.id}`);
      if (![200, 404].includes(response.status)) {
        failures.push(`cleanup ${resource.kind}`);
        console.error(`  FAIL cleanup ${resource.kind}: HTTP ${response.status}`);
      }
    }
  }

  function finish() {
    console.log(`\n${label}: ${passed} passed, ${failures.length} failed`);
    if (failures.length) process.exitCode = 1;
    return { passed, failed: failures.length };
  }
  console.log(`${label} against ${url.origin} (run ${run})`);
  return { base, run, test, req, login, admin, addAgent, job, next, submit, rpc, tool, cleanup, finish, resources, secrets };
}

export async function runHostedE2e() {
  const h = createHarness("Hosted relay e2e");
  let alice, bob, aSender, aWorker, bSender, bWorker, createdJob, claim;
  try {
    await h.test("hosted service health and unauthenticated session", async () => {
      accepted(await h.req("GET", "/healthz"), "health");
      const session = await h.req("GET", "/auth/session");
      accepted(session, "anonymous session");
      eq(session.data.authenticated, false, "anonymous session");
    });
    await h.test("two admitted users receive separate private workspaces", async () => {
      alice = await h.login("alice@example.test");
      bob = await h.login("bob@example.test");
      assert(alice.workspace.id !== bob.workspace.id, "Separate users must have different workspaces");
      for (const session of [alice, bob]) {
        assert(session.cookieHeaders.some((cookie) => /HttpOnly/i.test(cookie)), "Session cookie is HttpOnly");
        assert(session.cookieHeaders.some((cookie) => /SameSite=(Lax|Strict)/i.test(cookie)), "Session cookie has SameSite protection");
      }
    });
    await h.test("same connection handles are independent across workspaces", async () => {
      aSender = await h.addAgent(alice, "sender", { can_work: false });
      aWorker = await h.addAgent(alice, "worker");
      bSender = await h.addAgent(bob, "sender", { can_work: false });
      bWorker = await h.addAgent(bob, "worker");
      assert(aSender.id !== bSender.id && aWorker.id !== bWorker.id, "Hosted identities must be immutable server identities");
      const [a, b] = await Promise.all([h.admin(alice, "GET", "/v1/admin/agents"), h.admin(bob, "GET", "/v1/admin/agents")]);
      assert(a.data.agents.some((agent) => agent.id === aWorker.id) && !a.data.agents.some((agent) => agent.id === bWorker.id), "Alice sees only Alice's connections");
      assert(b.data.agents.some((agent) => agent.id === bWorker.id) && !b.data.agents.some((agent) => agent.id === aWorker.id), "Bob sees only Bob's connections");
    });
    await h.test("pairing is one use and credentials are never embedded in setup URLs", async () => {
      denied(await h.req("POST", "/v1/pair", { body: { code: aWorker.pairing.data.code } }), "pairing replay");
      const setup = await h.admin(alice, "GET", `/v1/admin/agents/${aWorker.id}/setup`);
      accepted(setup, "reopen connection setup");
      assert(!/[?&]key=|\/mcp\/(?:ar_|[A-Za-z0-9_-]{25})/.test(JSON.stringify(setup.data)), "Hosted setup URLs must not contain credentials");
      assert(!JSON.stringify(setup.data).includes(aWorker.token), "Hosted setup must not recover the worker credential");
      eq((await h.req("GET", "/v1/me", { token: aWorker.token })).data.id, aWorker.id, "paired credential identity");
    });
    await h.test("REST sends preserve context and retry one logical handoff", async () => {
      const input = { idempotency_key: `roundtrip-${h.run}`, inputs: { context: "Synthetic test context", decision: "Send a brief result" }, constraints: ["No external requests"], acceptance: ["Acknowledge the task"] };
      const first = await h.job(aSender, aWorker, "Complete round trip", input);
      accepted(first, "create handoff", [201]);
      createdJob = first.data.job;
      eq(createdJob.from, aSender.id, "sender comes from credential");
      const retry = await h.job(aSender, aWorker, "Complete round trip", input);
      accepted(retry, "retry handoff");
      eq(retry.data.job.id, createdJob.id, "retry returns existing handoff");
      eq(retry.data.replay, true, "retry marked as replay");
    });
    await h.test("worker receives complete context through header-authenticated delivery", async () => {
      const response = await h.next(aWorker);
      accepted(response, "claim handoff");
      eq(response.data.job.id, createdJob.id, "claimed handoff");
      eq(response.data.job.inputs.context, "Synthetic test context", "context preserved");
      assert(response.data.claim_id, "Hosted work response provides claim_id");
      assert(!JSON.stringify(response.data).includes(`/submit/${response.data.claim_id}`), "Claim is not embedded in a result URL");
      claim = response.data.claim_id;
      h.secrets.push(claim);
    });
    await h.test("result is retrievable with provenance and replay-safe submission", async () => {
      accepted(await h.submit(aWorker, claim), "submit result");
      accepted(await h.submit(aWorker, claim), "retry result");
      const response = await h.req("GET", `/v1/jobs/${createdJob.id}?full=1`, { token: aSender.token });
      accepted(response, "read result");
      eq(response.data.job.status, "completed", "completed status");
      eq(response.data.job.result.worker, aWorker.id, "worker attribution");
      eq(response.data.job.result.provenance.untrusted, true, "result provenance");
      assert(response.data.job.result.body.includes("synthetic fixture"), "Full result body is available");
    });
    await h.test("MCP initialization and tool list reflect this connection's permissions", async () => {
      const initialized = await h.rpc(aSender, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "local-test", version: "1" } });
      accepted(initialized, "MCP initialize");
      assert(initialized.data.result?.serverInfo, "MCP server metadata is present");
      const list = await h.rpc(aSender, "tools/list");
      const names = list.data.result.tools.map((tool) => tool.name);
      assert(names.includes("send_job") && names.includes("acknowledge_results"), "Sender sees send and acknowledgement tools");
      assert(!names.includes("submit_result"), "Sender-only connection has no worker submission tool");
    });
    await h.test("inbox delivery survives a lost response until explicitly acknowledged", async () => {
      const first = await h.tool(aSender, "check_inbox");
      const second = await h.tool(aSender, "check_inbox");
      assert(toolText(first).includes(createdJob.id) && toolText(second).includes(createdJob.id), "Reading twice must redeliver an unacknowledged result");
      const cursor = Number(toolText(first).match(/delivery_cursor: (\d+)/)?.[1]);
      assert(Number.isInteger(cursor) && cursor > 0, "Inbox provides a durable delivery cursor");
      assert(!(await h.tool(aSender, "acknowledge_results", { delivery_cursor: cursor })).isError, "acknowledgement accepted");
      const after = await h.tool(aSender, "check_inbox");
      assert(!toolText(after).includes(createdJob.id), "Acknowledged delivery disappears from unread inbox");
      assert(toolText(await h.tool(aSender, "check_inbox", { include_seen: true })).includes(createdJob.id), "Received result remains available in history");
    });
    let mcpJob;
    await h.test("MCP send idempotency survives concurrent retries", async () => {
      const args = { type: "task", to: aWorker.id, title: `MCP retry ${h.run}`, task: "Acknowledge this synthetic fixture.", idempotency_key: `mcp-${h.run}` };
      const results = await Promise.all([h.tool(aSender, "send_job", args), h.tool(aSender, "send_job", args)]);
      assert(results.every((result) => !result.isError), "Both concurrent sends succeed");
      const jobs = await h.req("GET", "/v1/jobs", { token: aSender.token });
      const matches = jobs.data.jobs.filter((job) => job.title === args.title);
      eq(matches.length, 1, "One logical handoff after concurrent retry");
      mcpJob = matches[0];
    });
    await h.test("MCP worker can complete a handoff and requester can read the result", async () => {
      const next = await h.tool(aWorker, "get_next_job");
      const claimId = toolText(next).match(/ct_[\w-]+/)?.[0];
      assert(claimId, "MCP returns a claim identifier");
      h.secrets.push(claimId);
      const result = await h.tool(aWorker, "submit_result", { claim_id: claimId, result: "## Summary\nMCP handoff completed using synthetic fixture data." });
      assert(!result.isError, "MCP submission accepted");
      assert(toolText(await h.tool(aSender, "get_job", { job_id: mcpJob.id, full: true })).includes("MCP handoff completed"), "Requester gets MCP result");
    });
    await h.test("completed revision is delivered again after feedback and rework", async () => {
      const inbox = await h.tool(aSender, "check_inbox");
      const cursor = Number(toolText(inbox).match(/delivery_cursor: (\d+)/)?.[1]);
      assert(cursor > 0, "Rework fixture has an inbox delivery");
      await h.tool(aSender, "acknowledge_results", { delivery_cursor: cursor });
      const reject = await h.req("POST", `/v1/jobs/${mcpJob.id}/reject`, { token: aSender.token, body: { feedback: "Add the word revised." } });
      accepted(reject, "request revision");
      const next = await h.next(aWorker);
      eq(next.data.job.id, mcpJob.id, "same job returned for revision");
      accepted(await h.submit(aWorker, next.data.claim_id, { summary: "Revised result." }), "submit revision");
      const revisedInbox = toolText(await h.tool(aSender, "check_inbox"));
      assert(revisedInbox.includes(mcpJob.id) && revisedInbox.includes("Revised result"), "New revision produces a fresh delivery");
    });
    await h.test("small inbox pages can be retried and acknowledged without skipping results", async () => {
      const previous = toolText(await h.tool(aSender, "check_inbox"));
      const previousCursor = Number(previous.match(/delivery_cursor: (\d+)/)?.[1]);
      if (previousCursor) await h.tool(aSender, "acknowledge_results", { delivery_cursor: previousCursor });
      const expected = new Set();
      for (const number of [1, 2, 3]) {
        const sent = await h.job(aSender, aWorker, `Pagination fixture ${number}`);
        accepted(sent, "create pagination fixture", [201]);
        expected.add(sent.data.job.id);
        const work = await h.next(aWorker);
        eq(work.data.job.id, sent.data.job.id, "pagination fixture claim");
        accepted(await h.submit(aWorker, work.data.claim_id, { summary: `Pagination result ${number}.` }), "complete pagination fixture");
      }
      for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
        const first = toolText(await h.tool(aSender, "check_inbox", { limit: 1 }));
        const retry = toolText(await h.tool(aSender, "check_inbox", { limit: 1 }));
        const matches = [...expected].filter((id) => first.includes(id));
        eq(matches.length, 1, "one unread result per page");
        assert(retry.includes(matches[0]), "lost page is delivered again before acknowledgement");
        const cursor = Number(first.match(/delivery_cursor: (\d+)/)?.[1]);
        assert(cursor > 0, "page contains delivery cursor");
        await h.tool(aSender, "acknowledge_results", { delivery_cursor: cursor });
        expected.delete(matches[0]);
      }
      eq(expected.size, 0, "all fixture results delivered exactly once after acknowledgement");
      assert(toolText(await h.tool(aSender, "check_inbox", { limit: 1 })).startsWith("No unacknowledged results"), "all pages acknowledged");
    });
    await h.test("schedule retries preserve identity and remain tenant scoped", async () => {
      const spec = { id: `routine-${h.run}`, every_minutes: 1440, start_in_minutes: 60, from: aSender.id, template: { type: "task", to: aWorker.id, title: "Alice's scheduled fixture", goal: "Acknowledge." } };
      const first = await h.admin(alice, "POST", "/v1/admin/schedules", spec);
      accepted(first, "save schedule");
      h.resources.push({ session: alice, kind: "schedules", id: first.data.schedule.id });
      const retry = await h.admin(alice, "POST", "/v1/admin/schedules", spec);
      accepted(retry, "retry schedule");
      eq(first.data.schedule.id, retry.data.schedule.id, "stable schedule identity");
      const own = await h.admin(alice, "GET", "/v1/admin/schedules");
      eq(own.data.schedules.filter((schedule) => schedule.id === first.data.schedule.id).length, 1, "one schedule after retry");
      const other = await h.admin(bob, "GET", "/v1/admin/schedules");
      assert(!other.data.schedules.some((schedule) => schedule.id === first.data.schedule.id), "Bob cannot list Alice's schedule");
    });
    await h.test("overview, audit events, and job listings stay within the workspace", async () => {
      const bJob = await h.job(bSender, bWorker, "Bob's private task");
      accepted(bJob, "Bob creates a task", [201]);
      for (const path of ["/v1/admin/overview", "/v1/jobs", "/v1/events?limit=500"]) {
        const response = await h.admin(bob, "GET", path);
        accepted(response, "Bob's scoped listing");
        assert(!response.text.includes(createdJob.id) && !response.text.includes(aWorker.id), "Alice's IDs cannot appear in Bob's listing");
      }
      const events = await h.admin(alice, "GET", "/v1/events?limit=500");
      assert(events.data.events.some((event) => event.job_id === createdJob.id), "Alice has the complete handoff audit trail");
      assert(!events.text.includes(bJob.data.job.id), "Alice's audit excludes Bob's task");
    });
    await h.test("workspace pause stops admission while preserving existing results", async () => {
      const settings = await h.admin(alice, "GET", "/v1/admin/workspace");
      accepted(settings, "workspace settings");
      eq(settings.data.workspace.id, alice.workspace.id, "workspace settings identity");
      eq(settings.data.limits.connections, 5, "beta connection limit");
      accepted(await h.admin(alice, "PATCH", "/v1/admin/workspace", { paused: true }), "pause workspace");
      try {
        denied(await h.job(aSender, aWorker, "Must not admit while paused"), "paused handoff admission", [403, 429]);
        const existing = await h.req("GET", `/v1/jobs/${createdJob.id}?full=1`, { token: aSender.token });
        accepted(existing, "read existing result while paused");
        eq(existing.data.job.status, "completed", "completed result preserved");
      } finally {
        accepted(await h.admin(alice, "PATCH", "/v1/admin/workspace", { paused: false }), "resume workspace");
      }
    });
    await h.test("workspace export contains owned history and omits authentication secrets", async () => {
      const exported = await h.admin(alice, "GET", "/v1/admin/export");
      accepted(exported, "export workspace");
      eq(exported.data.workspace.id, alice.workspace.id, "exported workspace");
      assert(exported.data.jobs.some((job) => job.id === createdJob.id && job.result?.body), "Export includes full result history");
      assert(!exported.text.includes(bWorker.id), "Export excludes the other workspace");
      for (const secret of [aSender.token, aWorker.token, alice.csrfToken, alice.cookie]) assert(!exported.text.includes(secret), "Export must not contain reusable authentication secrets");
      assert(!/"(?:token_hash|key_ciphertext|wake_headers|csrf_token)"/.test(exported.text), "Export must omit credential storage fields");
    });
  } finally {
    await h.cleanup();
    h.finish();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runHostedE2e();
