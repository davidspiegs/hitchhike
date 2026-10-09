#!/usr/bin/env node
/** Real Worker save routes against migrated SQLite, synthetic credentials and
 * no network. Includes a controlled settings edit inside an in-flight claim. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Validator } from "@cfworker/json-schema";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "hitchhike-settings-test-"));
const sqlite = new DatabaseSync(":memory:");
const originalFetch = globalThis.fetch;
let afterFirst = null, checks = 0;
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() {
    const row = sqlite.prepare(this.sql).get(...this.values) ?? null;
    if (afterFirst) await afterFirst(this.sql, row);
    return row;
  }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  execute() {
    const statement = sqlite.prepare(this.sql);
    if (/\bRETURNING\b/i.test(this.sql)) {
      const results = statement.all(...this.values);
      return { results, meta: { changes: sqlite.prepare("SELECT changes() AS n").get().n }, success: true };
    }
    return { results: [], meta: statement.run(...this.values), success: true };
  }
  async run() { return this.execute(); }
}
const DB = {
  prepare: sql => new Statement(sql),
  async batch(statements) {
    sqlite.exec("BEGIN");
    try { const result = statements.map(statement => statement.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
const base = "http://127.0.0.1:8787";
const env = { DB, HOSTED: "true", AUTH_PROVIDER: "google", ALLOW_DEV_AUTH: "true", SIGNUP_MODE: "public",
  PUBLIC_URL: base, ENCRYPTION_KEY: "synthetic-settings-encryption-key-only" };
const selfhost = { ...env, HOSTED: "false", WORKSPACE_ID: "default", ADMIN_TOKEN: "synthetic-settings-owner-key-only-12345",
  WAKE_ALLOWED_HOSTS: "hooks.vendor.example" };
const callback = "http://127.0.0.1:8123/callback";
const wakeUrl = "https://hooks.vendor.example/wake";
const check = async (name, work) => { await work(); console.log(`ok ${++checks} - ${name}`); };
globalThis.fetch = async () => { throw new Error("External requests are forbidden in settings tests"); };

try {
  for (const name of (await readdir(join(root, "migrations"))).filter(name => name.endsWith(".sql")).sort()) {
    sqlite.exec(await readFile(join(root, "migrations", name), "utf8"));
  }
  const modulePath = join(temporary, "settings.mjs");
  await build({ stdin: { contents: 'export { default } from "./src/index.ts"; export { claimNext, submitResult } from "./src/store.ts"; export { openAgentKey } from "./src/crypto.ts";', resolveDir: root },
    bundle: true, platform: "node", format: "esm", outfile: modulePath, logLevel: "silent" });
  const { default: worker, claimNext, submitResult, openAgentKey } = await import(pathToFileURL(modulePath).href);
  async function request(path, { method = "GET", body, form, token, cookie, csrf, settings = env } = {}) {
    const headers = new Headers({ accept: "application/json", origin: base });
    if (token) headers.set("authorization", "Bearer " + token);
    if (cookie) headers.set("cookie", cookie);
    if (csrf) headers.set("x-csrf-token", csrf);
    let payload;
    if (body !== undefined) { headers.set("content-type", "application/json"); payload = JSON.stringify(body); }
    if (form) { headers.set("content-type", "application/x-www-form-urlencoded"); payload = new URLSearchParams(form); }
    const background = [];
    const response = await worker.fetch(new Request(base + path, { method, headers, body: payload }), settings,
      { waitUntil: promise => background.push(promise), passThroughOnException() {} });
    for (const result of await Promise.allSettled(background)) assert.equal(result.status, "fulfilled");
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { /* OAuth HTML and redirects have no JSON. */ }
    return { status: response.status, headers: response.headers, text, data };
  }
  const signedIn = await request("/auth/dev", { method: "POST", body: { email: "settings@example.test" } });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get("set-cookie").split(";")[0];
  const session = await request("/auth/session", { cookie });
  assert.equal(session.status, 200);
  const owner = (path, body, method = "POST") => request(path, { method, body, cookie, csrf: session.data.csrfToken });
  const agentRow = id => sqlite.prepare("SELECT * FROM agents WHERE id=?").get(id);
  async function add(id, canWork) {
    const result = await owner("/v1/admin/agents", { id, platform: "other", can_request: true, can_work: canWork, work_types: ["task"] });
    assert.equal(result.status, 201);
    const pairing = await owner(`/v1/admin/agents/${result.data.agent.id}/pairing`, {});
    assert.equal(pairing.status, 200);
    const redemption = await request("/v1/pair", { method: "POST", body: { code: pairing.data.code } });
    assert.equal(redemption.status, 200);
    return { id: result.data.agent.id, token: redemption.data.token };
  }
  const sender = await add("settings-sender", false), receiver = await add("settings-worker", true);
  const registration = await request("/oauth/register", { method: "POST", body: { client_name: "Settings fixture", redirect_uris: [callback], token_endpoint_auth_method: "none" } });
  assert.equal(registration.status, 201);
  const clientId = registration.data.client_id;
  async function authorize(agent) {
    const verifier = randomBytes(48).toString("base64url");
    const parameters = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", scope: "relay:read relay:send relay:work offline_access", resource: base + "/mcp" });
    const page = await request("/oauth/authorize?" + parameters, { cookie });
    assert.equal(page.status, 200);
    const requestId = page.text.match(/name="request_id" value="([^"]+)"/)?.[1];
    assert.ok(requestId);
    const approval = await request("/oauth/authorize", { method: "POST", cookie, form: { request_id: requestId, csrf_token: session.data.csrfToken, agent_id: agent.id, decision: "allow" } });
    assert.equal(approval.status, 303);
    const code = new URL(approval.headers.get("location")).searchParams.get("code");
    const result = await request("/oauth/token", { method: "POST", form: { grant_type: "authorization_code", client_id: clientId, redirect_uri: callback, code, code_verifier: verifier, resource: base + "/mcp" } });
    assert.equal(result.status, 200);
    return result.data;
  }
  const toolCatalog = async token => {
    const result = await request("/mcp", { method: "POST", token, body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } });
    assert.equal(result.status, 200);
    return result.data.result.tools;
  };
  const tools = async token => (await toolCatalog(token)).map(tool => tool.name);
  const job = async title => {
    const result = await request("/v1/jobs", { method: "POST", token: sender.token, body: { type: "task", to: receiver.id, title, goal: "Return a synthetic fixture acknowledgement." } });
    assert.equal(result.status, 201); return result.data.job;
  };
  const claim = async () => {
    const result = await request("/v1/work/next?format=json", { method: "POST", token: receiver.token });
    assert.equal(result.status, 200); return result.data;
  };

  const callTool = async (token, name, args = {}) => {
    const result = await request("/mcp", { method: "POST", token, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } });
    assert.equal(result.status, 200);
    assert.ok(!result.data.error, JSON.stringify(result.data.error));
    return result.data.result;
  };
  let dot, dotTokens, chatTokens;
  await check("relay-side Dot and ChatGPT records preserve grants during setup reads without creating schedules", async () => {
    const created = await owner("/v1/admin/agents", { id: "dot", platform: "dot" });
    assert.equal(created.status, 201); dot = created.data.agent;
    assert.equal(dot.platform, "dot"); assert.equal(dot.poll_minutes, null);
    assert.equal(created.data.token, undefined); assert.equal(created.data.pairing, undefined);
    assert.match(JSON.stringify(created.data.guide), /same authenticated connection/);
    assert.ok(!JSON.stringify(created.data.guide).includes(agentRow(dot.id).token_hash));
    const chat = await owner("/v1/admin/agents", { id: "chatgpt", platform: "chatgpt" });
    assert.equal(chat.status, 201); assert.notEqual(chat.data.agent.id, dot.id);
    dotTokens = await authorize(dot); chatTokens = await authorize(chat.data.agent);
    const before = agentRow(dot.id);
    for (let attempt = 0; attempt < 3; attempt++) {
      const setup = await owner(`/v1/admin/agents/${dot.id}/setup`, undefined, "GET");
      assert.equal(setup.status, 200); assert.equal(setup.data.guide.platform, "dot");
      assert.equal(setup.data.pairing, undefined); assert.equal(setup.data.token, undefined);
      assert.deepEqual(setup.data.guide.prompts.map(p => p.target), ["chatgpt", "dot", "both"]);
      const shared = await owner(`/v1/admin/agents/${chat.data.agent.id}/setup`, undefined, "GET");
      for (const prompt of shared.data.guide.prompts) {
        assert.ok(prompt.copy.includes(chat.data.agent.id));
        assert.ok(!prompt.copy.includes(dot.id));
        assert.match(prompt.copy, /Check connection_status matches this ID/);
        assert.match(prompt.copy, /Stop on an identity mismatch/);
        assert.ok(!JSON.stringify(prompt).includes(chatTokens.access_token));
      }
    }
    assert.deepEqual(agentRow(dot.id), before);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pairing_codes WHERE agent_id=?").get(dot.id).n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM schedules").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, 0);
    assert.ok((await tools(dotTokens.access_token)).includes("connection_status"));
    const refresh = await request("/oauth/token", { method: "POST", form: { grant_type: "refresh_token", client_id: clientId, refresh_token: dotTokens.refresh_token, resource: base + "/mcp" } });
    assert.equal(refresh.status, 200); dotTokens = refresh.data;
  });
  await check("exported MCP patterns accept full IDs and multiline feedback under search and full-match validation", async () => {
    const catalog = await toolCatalog(dotTokens.access_token);
    const sendSchema = catalog.find(tool => tool.name === "send_job").inputSchema;
    const values = {
      to: "ag_01m3tptest123456789abcdefgh",
      idempotency_key: "dot-research-company-discovery-20261001-fixture-1",
    };
    const brief = { ...values, type: "task", title: "Schema fixture", task: "Local schema validation only." };
    assert.equal(new Validator(sendSchema, "2020-12", false).validate(brief).valid, true);
    for (const [key, value] of Object.entries(values)) {
      assert.equal(new RegExp(`^(?:${sendSchema.properties[key].pattern})$`, "u").test(value), true, key);
    }
    const patterned = catalog.flatMap(tool => Object.entries(tool.inputSchema.properties)
      .filter(([, schema]) => schema.pattern).map(([key, schema]) => ({ field: `${tool.name}.${key}`, schema })));
    assert.ok(patterned.some(({ field }) => field === "send_back.feedback"));
    assert.ok(patterned.some(({ field }) => field === "submit_result.claim_id"));
    for (const { field, schema } of patterned) {
      assert.equal(schema.type, "string", field); assert.equal(schema.minLength, 1, field);
      assert.ok([200, 20000].includes(schema.maxLength), field);
      const validator = new Validator(schema, "2020-12", false);
      const full = new RegExp(`^(?:${schema.pattern})$`, "u");
      for (const value of ["", " ", "\n\t", "\u2003", "x", "*", "two words", "\nFirst line.\nSecond line.\n", "é", "😀"]) {
        const expected = /\S/u.test(value);
        assert.equal(validator.validate(value).valid, expected, field + " schema " + JSON.stringify(value));
        assert.equal(full.test(value), expected, field + " full match " + JSON.stringify(value));
      }
      assert.equal(validator.validate("x".repeat(schema.maxLength)).valid, true, field);
      assert.equal(validator.validate("x".repeat(schema.maxLength + 1)).valid, false, field);
      assert.equal(validator.validate(42).valid, false, field);
    }
  });
  await check("MCP rejects blank and overlength IDs before creating a job", async () => {
    const before = sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get().n;
    for (const key of ["to", "idempotency_key"]) for (const value of ["", " \n\t", "x".repeat(201)]) {
      const result = await request("/mcp", { method: "POST", token: chatTokens.access_token, body: {
        jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_job", arguments: {
          to: dot.id, type: "task", title: "Invalid schema fixture", task: "Must not create a job.",
          idempotency_key: "invalid-schema-fixture", [key]: value,
        } },
      } });
      assert.equal(result.status, 200); assert.equal(result.data.error?.code, -32602);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, before);
  });
  await check("identity reflects the actual OAuth grant, including shared-app mismatch and effective permissions", async () => {
    const status = async token => JSON.parse((await callTool(token, "connection_status")).content[0].text);
    const own = await status(dotTokens.access_token), other = await status(chatTokens.access_token);
    assert.equal(own.id, dot.id); assert.equal(own.platform, "dot"); assert.equal(own.can_request, true); assert.equal(own.can_work, true);
    assert.notEqual(other.id, dot.id); assert.equal(other.platform, "chatgpt");
    assert.match(own.scheduling, /does not create or verify/);
    for (const secret of [dotTokens.access_token, dotTokens.refresh_token, agentRow(dot.id).token_hash, agentRow(dot.id).key_ciphertext]) assert.ok(!JSON.stringify(own).includes(secret));
    assert.equal((await owner("/v1/admin/agents", { id: dot.id, can_request: false })).status, 200);
    assert.equal((await status(dotTokens.access_token)).can_request, false);
    const readWorker = await tools(dotTokens.access_token);
    assert.ok(readWorker.includes("connection_status") && readWorker.includes("get_next_job") && !readWorker.includes("send_job"));
    assert.equal((await owner("/v1/admin/agents", { id: dot.id, can_request: true })).status, 200);
    const sendOnly = await authorize(sender);
    assert.equal((await owner("/v1/admin/agents", { id: sender.id, can_work: true })).status, 200);
    assert.equal((await status(sendOnly.access_token)).can_work, false, "old consent cannot gain receive scope");
    assert.equal((await owner("/v1/admin/agents", { id: sender.id, can_work: false })).status, 200);
  });
  await check("Dot OAuth can send and receive synthetic MCP work; identity checks do not claim jobs", async () => {
    const send = await callTool(chatTokens.access_token, "send_job", { to: dot.id, type: "task", title: "Dot fixture", task: "Return the synthetic Dot marker.", idempotency_key: "dot-fixture-request" });
    assert.ok(!send.isError); const id = send.content[0].text.match(/job_[a-z0-9]+/)[0];
    await callTool(dotTokens.access_token, "connection_status");
    assert.equal(sqlite.prepare("SELECT status FROM jobs WHERE id=?").get(id).status, "queued");
    const pickup = await callTool(dotTokens.access_token, "get_next_job");
    const claimId = pickup.content[0].text.match(/ct_[\w-]+/)[0];
    const done = await callTool(dotTokens.access_token, "submit_result", { claim_id: claimId, result: "## Summary\nSynthetic Dot marker." });
    assert.ok(!done.isError);
    const inbox = await callTool(chatTokens.access_token, "check_inbox"); assert.match(inbox.content[0].text, /Synthetic Dot marker/);
    const sentBack = await callTool(dotTokens.access_token, "send_job", { to: receiver.id, type: "task", title: "Dot sender fixture", task: "Return a local fixture.", idempotency_key: "dot-sender-fixture" });
    assert.ok(!sentBack.isError);
    const retry = await callTool(dotTokens.access_token, "send_job", { to: receiver.id, type: "task", title: "Dot sender fixture", task: "Return a local fixture.", idempotency_key: "dot-sender-fixture" });
    assert.equal(retry.content[0].text.match(/job_[a-z0-9]+/)[0], sentBack.content[0].text.match(/job_[a-z0-9]+/)[0]);
    const outgoingId = sentBack.content[0].text.match(/job_[a-z0-9]+/)[0];
    const picked = await claim(); assert.equal(picked.job.id, outgoingId);
    const submitted = await callTool(receiver.token, "submit_result", { claim_id: picked.claim_id, result: "## Summary\nSynthetic outgoing result." });
    assert.ok(!submitted.isError);
    assert.match((await callTool(dotTokens.access_token, "check_inbox")).content[0].text, /Synthetic outgoing result/);
  });

  await check("full send-only edit and no-op save keep generation, credentials, OAuth and refresh", async () => {
    const before = agentRow(sender.id), tokens = await authorize(sender);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await owner("/v1/admin/agents", { id: sender.id, name: "Renamed sender", can_work: false, can_request: true, work_types: [], poll_minutes: null })).status, 200);
      const saved = agentRow(sender.id);
      assert.equal(saved.auth_generation, before.auth_generation); assert.equal(saved.token_hash, before.token_hash);
      assert.ok((await tools(tokens.access_token)).includes("send_job"));
    }
    const refresh = await request("/oauth/token", { method: "POST", form: { grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token, resource: base + "/mcp" } });
    assert.equal(refresh.status, 200); assert.ok((await tools(refresh.data.access_token)).includes("send_job"));
  });
  await check("permission toggles narrow existing consent and do not silently grant new scope", async () => {
    const full = await authorize(receiver), limited = await authorize(sender);
    const generation = agentRow(receiver.id).auth_generation;
    assert.equal((await owner("/v1/admin/agents", { id: receiver.id, can_request: false, can_work: false })).status, 200);
    const narrowed = await tools(full.access_token); assert.ok(!narrowed.includes("send_job") && !narrowed.includes("get_next_job"));
    assert.equal((await owner("/v1/admin/agents", { id: receiver.id, can_request: true, can_work: true })).status, 200);
    const restored = await tools(full.access_token); assert.ok(restored.includes("send_job") && restored.includes("get_next_job"));
    assert.equal(agentRow(receiver.id).auth_generation, generation);
    assert.equal((await owner("/v1/admin/agents", { id: sender.id, can_work: true, work_types: ["task"] })).status, 200);
    assert.ok(!(await tools(limited.access_token)).includes("get_next_job"));
    assert.ok((await tools((await authorize(sender)).access_token)).includes("get_next_job"));
    assert.equal((await owner("/v1/admin/agents", { id: sender.id, can_work: false })).status, 200);
  });
  await check("disable during result lookup fences the mutation and re-enable cannot revive its claim", async () => {
    const fixture = await job("In-flight permission fence"), work = await claim();
    assert.equal(work.job.id, fixture.id);
    let intercepted = false;
    afterFirst = async (sql, row) => {
      if (!sql.includes("SELECT * FROM jobs") || row?.id !== fixture.id) return;
      afterFirst = null; intercepted = true;
      assert.equal((await owner("/v1/admin/agents", { id: receiver.id, can_work: false })).status, 200);
    };
    const outcome = await submitResult({ ...env, WORKSPACE_ID: agentRow(receiver.id).workspace_id }, work.claim_id, { summary: "Must not commit" }, [], Date.now(), receiver.id);
    assert.ok(intercepted); assert.equal(outcome.kind, "stale", "Revoked claims must not be mislabeled as exhausted storage");
    assert.equal(sqlite.prepare("SELECT status FROM jobs WHERE id=?").get(fixture.id).status, "claimed");
    const receipt = sqlite.prepare("SELECT revoked_at FROM claims WHERE token_hash=?").get(createHash("sha256").update(work.claim_id).digest("hex"));
    assert.ok(receipt.revoked_at);
    assert.equal((await owner("/v1/admin/agents", { id: receiver.id, can_work: true })).status, 200);
    const reused = await submitResult({ ...env, WORKSPACE_ID: agentRow(receiver.id).workspace_id }, work.claim_id, { summary: "Must stay revoked" }, [], Date.now(), receiver.id);
    assert.equal(reused.kind, "unknown");
    assert.equal((await owner(`/v1/jobs/${fixture.id}/cancel`, {})).status, 200);
  });
  await check("stale worker snapshot cannot issue a claim after a disabling save", async () => {
    const fixture = await job("In-flight claim issuance"), snapshot = agentRow(receiver.id);
    assert.equal((await owner("/v1/admin/agents", { id: receiver.id, can_work: false })).status, 200);
    const outcome = await claimNext({ ...env, WORKSPACE_ID: snapshot.workspace_id }, snapshot, Date.now());
    assert.equal(outcome.job, null);
    assert.equal(sqlite.prepare("SELECT status FROM jobs WHERE id=?").get(fixture.id).status, "queued");
    assert.equal((await owner("/v1/admin/agents", { id: receiver.id, can_work: true })).status, 200);
    assert.equal((await owner(`/v1/jobs/${fixture.id}/cancel`, {})).status, 200);
  });
  await check("setup reads and settings preserve hashed pairing while explicit replacement and rotation revoke it", async () => {
    const pending = await owner(`/v1/admin/agents/${receiver.id}/pairing`, {});
    assert.equal(pending.status, 200);
    for (const method of ["GET", "POST"]) assert.equal((await owner(`/v1/admin/agents/${receiver.id}/setup`, method === "POST" ? {} : undefined, method)).status, 200);
    const saved = await owner("/v1/admin/agents", { id: receiver.id, name: "Renamed worker" });
    assert.equal(saved.status, 200); assert.equal(saved.data.pairing, undefined);
    const rows = sqlite.prepare("SELECT * FROM pairing_codes WHERE agent_id=?").all(receiver.id);
    assert.equal(rows.length, 1); assert.equal(rows[0].code_hash, createHash("sha256").update(pending.data.code).digest("hex"));
    assert.ok(!JSON.stringify(rows).includes(pending.data.code));
    assert.equal((await request("/v1/pair", { method: "POST", body: { code: pending.data.code } })).status, 200);
    const first = await owner(`/v1/admin/agents/${receiver.id}/pairing`, {}), second = await owner(`/v1/admin/agents/${receiver.id}/pairing`, {});
    assert.equal((await request("/v1/pair", { method: "POST", body: { code: first.data.code } })).status, 400);
    assert.equal((await request("/v1/pair", { method: "POST", body: { code: second.data.code } })).status, 200);
    const pendingRotation = await owner(`/v1/admin/agents/${receiver.id}/pairing`, {}), tokens = await authorize(receiver), before = agentRow(receiver.id);
    const rotated = await owner("/v1/admin/agents", { id: receiver.id, rotate_token: true });
    assert.equal(rotated.status, 200); assert.ok(rotated.data.pairing?.expires_at);
    assert.equal(agentRow(receiver.id).auth_generation, before.auth_generation + 1);
    assert.equal((await request("/v1/pair", { method: "POST", body: { code: pendingRotation.data.code } })).status, 400);
    assert.equal((await request("/v1/me", { token: receiver.token })).status, 401);
    assert.equal((await request("/mcp", { method: "POST", token: tokens.access_token, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).status, 401);
    assert.equal((await request("/oauth/token", { method: "POST", form: { grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token } })).status, 400);
  });
  const selfSave = (body, settings = selfhost) => request("/v1/admin/agents", { method: "POST", token: selfhost.ADMIN_TOKEN, body: { id: "webhook-save", ...body }, settings });
  const decrypt = (row, destination = row.wake_url, settings = selfhost) => openAgentKey(settings.ENCRYPTION_KEY, `wake-headers:default:${row.id}:${destination}`, row.wake_headers.slice(4));
  await check("actual self-host save seals webhook headers and rebinds them when only the URL changes", async () => {
    const saved = await selfSave({ platform: "other", can_work: true, work_types: ["task"], wake_url: wakeUrl, wake_headers: { Authorization: "Bearer synthetic-webhook-secret" } });
    assert.equal(saved.status, 201);
    const first = agentRow("webhook-save"); assert.match(first.wake_headers, /^wh1:v1:/);
    assert.ok(!JSON.stringify(first).includes("synthetic-webhook-secret"));
    assert.deepEqual(JSON.parse(await decrypt(first)), { Authorization: "Bearer synthetic-webhook-secret" });
    const changedUrl = wakeUrl + "-changed";
    assert.equal((await selfSave({ wake_url: changedUrl })).status, 200);
    const changed = agentRow("webhook-save");
    assert.deepEqual(JSON.parse(await decrypt(changed)), { Authorization: "Bearer synthetic-webhook-secret" });
    assert.equal(await decrypt(changed, wakeUrl), null);
    const rotatedKey = { ...selfhost, ENCRYPTION_KEY: "synthetic-settings-replacement-key-only", ENCRYPTION_KEY_PREVIOUS: selfhost.ENCRYPTION_KEY };
    assert.equal((await selfSave({ name: "Resealed webhook" }, rotatedKey)).status, 200);
    assert.deepEqual(JSON.parse(await decrypt(agentRow("webhook-save"), changedUrl, rotatedKey)), { Authorization: "Bearer synthetic-webhook-secret" });
    assert.equal(await decrypt(agentRow("webhook-save")), null);
    assert.equal((await selfSave({ wake_url: null }, rotatedKey)).status, 200);
    assert.equal(agentRow("webhook-save").wake_headers, null);
  });
  await check("actual save rejects undeliverable destinations and invalid headers before writing", async () => {
    const before = agentRow("webhook-save");
    for (const url of ["http://127.0.0.1/hook", "https://localhost/hook", "https://169.254.169.254/hook", "https://other.vendor.example/hook", wakeUrl + "#fragment"]) {
      const denied = await selfSave({ wake_url: url, wake_headers: { Authorization: "Bearer synthetic-secret" } });
      assert.equal(denied.status, 400); assert.ok(denied.data.message || denied.data.error);
      assert.deepEqual(agentRow("webhook-save"), before);
    }
    for (const headers of [{ Host: "other.example" }, { Authorization: "secret\r\nHost: other" }, { "X-Relay-Delivery-Id": "override" }]) {
      assert.equal((await selfSave({ wake_url: wakeUrl, wake_headers: headers })).status, 400);
      assert.deepEqual(agentRow("webhook-save"), before);
    }
  });
  console.log(`${checks} connection settings checks passed`);
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
  await rm(temporary, { recursive: true, force: true });
}
