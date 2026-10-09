/** Isolated delivery regressions: in-memory SQLite and injected fetch only. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "relay-delivery-test-"));
const sqlite = new DatabaseSync(":memory:");
let checks = 0;
let forbiddenRequests = 0;
const check = async (name, fn) => { await fn(); assert.equal(forbiddenRequests, 0, "A suppressed delivery attempted a request"); checks++; console.log(`ok ${checks} - ${name}`); };
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
      const output = statements.map((s) => ({ meta: sqlite.prepare(s.sql).run(...s.values), success: true }));
      sqlite.exec("COMMIT"); return output;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
const origin = "https://relay.example";
const wakeUrl = "https://hooks.vendor.example/wake";
const env = { DB, HOSTED: "false", WORKSPACE_ID: "default", ENCRYPTION_KEY: "test-key-one", WAKE_ALLOWED_HOSTS: "hooks.vendor.example" };
const hosted = { ...env, HOSTED: "true", WORKSPACE_ID: "ws_other" };
const now = 1_800_000_000_000;
const row = () => sqlite.prepare("SELECT * FROM wake_deliveries LIMIT 1").get();
const job = () => sqlite.prepare("SELECT * FROM jobs WHERE id='job-1'").get();
function fixture() {
  // Each case reuses synthetic IDs. Durable conversation history intentionally
  // survives job removal, so reset the isolated transcript before reseeding.
  sqlite.exec("DELETE FROM wake_deliveries; DELETE FROM events; DELETE FROM conversations; DELETE FROM conversation_chains; DELETE FROM jobs; DELETE FROM agents; UPDATE workspaces SET paused=0;");
  sqlite.prepare("INSERT OR IGNORE INTO workspaces(id,name,created_at) VALUES ('ws_other','Other',?)").run(now);
  sqlite.prepare("INSERT INTO agents(id,workspace_id,handle,name,token_hash,can_work,work_types,wake_url,created_at) VALUES ('worker-1','default','worker','Worker','hash-1',1,'[\"research\"]',?,?)").run(wakeUrl, now);
  sqlite.prepare("INSERT INTO agents(id,workspace_id,handle,name,token_hash,can_work,work_types,wake_url,created_at) VALUES ('worker-2','ws_other','worker','Other','hash-2',1,'[\"research\"]',?,?)").run(wakeUrl, now);
  sqlite.prepare("INSERT INTO jobs(id,workspace_id,v,type,from_agent,to_agent,title,spec,status,lease_seconds,created_at,updated_at) VALUES ('job-1','default','1','research','owner','worker-1','A \\\"title\\\"','{\"goal\":\"PRIVATE TASK CONTENT\"}','queued',300,?,?)").run(now, now);
}
const noNetwork = async () => { forbiddenRequests++; throw new Error("Unexpected mock network call"); };
try {
  for (const file of (await readdir(join(root, "migrations"))).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(await readFile(join(root, "migrations", file), "utf8"));
  const modulePath = join(temporary, "delivery.mjs");
  await build({ entryPoints: [join(root, "src/delivery.ts")], bundle: true, platform: "node", format: "esm", outfile: modulePath, logLevel: "silent" });
  const delivery = await import(pathToFileURL(modulePath).href);
  const drain = (at = now, send = noNetwork, scoped = env) => delivery.drainDoorbells(scoped, origin, at, send);

  await check("hosted URL validation fails closed and matches only exact service hosts", async () => {
    assert.equal(delivery.validateWakeUrl(hosted, wakeUrl), null);
    for (const url of ["https://sub.hooks.vendor.example/wake", "https://vendor.example/wake", "http://hooks.vendor.example/wake", "https://hooks.vendor.example:8443/wake", "https://hooks.vendor.example/wake#fragment", "https://user:pass@hooks.vendor.example/wake", "https://127.0.0.1/wake", "https://[::1]/wake", "https://2130706433/wake", "https://169.254.169.254/latest", "https://machine.local/wake", "https://metadata.google.internal/wake", "https://localhost/wake"]) assert.ok(delivery.validateWakeUrl(hosted, url), url);
    assert.ok(delivery.validateWakeUrl({ ...hosted, WAKE_ALLOWED_HOSTS: "" }, wakeUrl));
    assert.ok(delivery.validateWakeUrl({ ...hosted, WAKE_ALLOWED_HOSTS: "*.vendor.example" }, wakeUrl));
  });
  await check("header secrets are encrypted and bound to workspace, connection and URL", async () => {
    const encoded = await delivery.prepareWakeHeaders(hosted, "worker-1", wakeUrl, JSON.stringify({ Authorization: "Bearer TOP-SECRET" }));
    assert.match(encoded, /^wh1:v1:/); assert.ok(!encoded.includes("TOP-SECRET"));
    await assert.rejects(delivery.prepareWakeHeaders(hosted, "worker-2", wakeUrl, encoded));
    await assert.rejects(delivery.prepareWakeHeaders({ ...hosted, WORKSPACE_ID: "another" }, "worker-1", wakeUrl, encoded));
    await assert.rejects(delivery.prepareWakeHeaders(hosted, "worker-1", wakeUrl + "/changed", encoded));
    const changed = await delivery.prepareWakeHeaders(hosted, "worker-1", wakeUrl + "/changed", encoded, wakeUrl); assert.match(changed, /^wh1:/);
    const rotated = await delivery.prepareWakeHeaders({ ...hosted, ENCRYPTION_KEY: "new-key", ENCRYPTION_KEY_PREVIOUS: env.ENCRYPTION_KEY }, "worker-1", wakeUrl, encoded); assert.match(rotated, /^wh1:/);
    await assert.rejects(delivery.prepareWakeHeaders({ ...hosted, ENCRYPTION_KEY: undefined, ADMIN_TOKEN: "not-hosted-fallback" }, "worker-1", wakeUrl, '{"Authorization":"secret"}'));
  });
  await check("invalid and transport-controlling headers are rejected before persistence", async () => {
    for (const headers of [{ Host: "evil.example" }, { "X-Relay-Delivery-Id": "override" }, { "X-Forwarded-Host": "evil" }, { Authorization: "secret\r\nHost: evil" }, { "bad name": "bad" }]) await assert.rejects(delivery.prepareWakeHeaders(env, "worker-1", wakeUrl, JSON.stringify(headers)));
  });
  await check("hosted enqueue and dispatch remain disabled even with an allowlist", async () => {
    fixture(); sqlite.prepare("UPDATE jobs SET workspace_id='ws_other',to_agent='worker-2' WHERE id='job-1'").run();
    await delivery.enqueueDoorbells(hosted, [job()], origin, now);
    await drain(now, noNetwork, hosted); assert.equal(row(), undefined);
  });
  await check("queue reconciliation recovers dropped enqueue and suppresses duplicate deliveries", async () => {
    fixture();
    const encoded = await delivery.prepareWakeHeaders(env, "worker-1", wakeUrl, '{"Authorization":"Bearer TOP-SECRET"}');
    sqlite.prepare("UPDATE agents SET wake_headers=? WHERE id='worker-1'").run(encoded);
    let calls = 0;
    const send = async (url, options) => {
      calls++; assert.equal(url, wakeUrl); assert.equal(options.redirect, "manual"); assert.ok(options.signal);
      assert.equal(options.headers.Authorization, "Bearer TOP-SECRET"); assert.equal(options.headers["x-relay-delivery-id"].length, 64);
      assert.ok(!options.body.includes("PRIVATE TASK CONTENT")); assert.equal(JSON.parse(options.body).job_id, "job-1");
      return new Response("ignored", { status: 200 });
    };
    await drain(now, send); assert.equal(row().status, "delivered"); assert.equal(calls, 1);
    await delivery.enqueueDoorbells(env, [job(), job()], origin, now); await drain(now + 1000, send); assert.equal(calls, 1);
    assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM events").all()).includes("TOP-SECRET"));
    sqlite.prepare("UPDATE jobs SET updated_at=? WHERE id='job-1'").run(now + 2000);
    await drain(now + 2000, send); assert.equal(calls, 2);
  });
  await check("overlapping drains atomically lease each delivery once", async () => {
    fixture(); let calls = 0;
    const send = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return new Response(null, { status: 204 }); };
    await Promise.all([drain(now, send), drain(now, send)]); assert.equal(calls, 1); assert.equal(row().attempts, 1);
  });
  await check("transient failures back off, keep stable IDs, and stop after five attempts", async () => {
    fixture(); const ids = []; let at = now;
    const send = async (_url, opts) => { ids.push(opts.headers["x-relay-delivery-id"]); return new Response(null, { status: 503 }); };
    for (let attempt = 1; attempt <= 5; attempt++) {
      await drain(at, send); assert.equal(row().attempts, attempt);
      if (attempt < 5) { assert.equal(row().next_attempt_at - at, 60_000 * 2 ** (attempt - 1)); await drain(row().next_attempt_at - 1, noNetwork); at = row().next_attempt_at; }
    }
    assert.equal(row().status, "failed"); assert.equal(new Set(ids).size, 1);
    await drain(at + 3600_000, noNetwork); assert.equal(row().attempts, 5);
  });
  await check("redirects and permanent client errors are never followed or retried", async () => {
    for (const status of [302, 400, 401, 403, 404]) {
      fixture(); let calls = 0;
      await drain(now, async (_url, options) => { calls++; assert.equal(options.redirect, "manual"); return new Response(null, { status, headers: { Location: "http://169.254.169.254/secret" } }); });
      assert.equal(row().status, "failed"); await drain(now + 3600_000, noNetwork); assert.equal(calls, 1);
    }
  });
  await check("Retry-After is bounded and transport failures remain retryable", async () => {
    fixture(); await drain(now, async () => new Response(null, { status: 429, headers: { "Retry-After": "999999" } }));
    assert.equal(row().next_attempt_at, now + 900_000); assert.equal(row().status, "pending");
    fixture(); await drain(now, async () => { throw new Error("Sensitive URL and credential details"); });
    assert.equal(row().status, "pending"); assert.equal(row().last_error, "network_error"); assert.ok(!JSON.stringify(row()).includes("Sensitive"));
  });
  await check("expired dispatch leases recover and exhausted crashed deliveries terminate", async () => {
    fixture(); await delivery.enqueueDoorbells(env, [job()], origin, now);
    sqlite.prepare("UPDATE wake_deliveries SET status='leased',attempts=1,lease_token='crashed',lease_expires_at=?").run(now + 90_000);
    await drain(now, noNetwork); await drain(now + 90_000, async () => new Response(null, { status: 204 })); assert.equal(row().attempts, 2); assert.equal(row().status, "delivered");
    fixture(); await delivery.enqueueDoorbells(env, [job()], origin, now);
    sqlite.prepare("UPDATE wake_deliveries SET status='leased',attempts=5,lease_token='crashed',lease_expires_at=?").run(now);
    await drain(now, noNetwork); assert.equal(row().status, "failed"); assert.equal(row().last_error, "retry_limit");
  });
  await check("canceled, deleted, disabled, and no-longer-authorized targets cannot receive wake-ups", async () => {
    for (const change of ["UPDATE jobs SET status='canceled'", `UPDATE jobs SET expires_at=${now}`, "DELETE FROM jobs", "DELETE FROM agents WHERE id='worker-1'", "UPDATE agents SET can_work=0 WHERE id='worker-1'", "UPDATE agents SET work_types='[]' WHERE id='worker-1'", "UPDATE jobs SET from_agent='requester'; UPDATE agents SET accept_from='[]' WHERE id='worker-1'", "UPDATE agents SET wake_url='https://evil.example/wake' WHERE id='worker-1'"]) {
      fixture(); await delivery.enqueueDoorbells(env, [job()], origin, now); sqlite.exec(change); await drain(now, noNetwork);
      assert.ok(!row() || ["canceled", "failed"].includes(row().status));
    }
  });
  await check("in-flight delivery completion cannot recreate audit rows after job deletion", async () => {
    fixture();
    await drain(now, async () => { sqlite.exec("DELETE FROM jobs; DELETE FROM events"); return new Response(null, { status: 204 }); });
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM events").get().n, 0);
  });
  await check("workspace and service pause preserve pending work until resume", async () => {
    fixture(); await delivery.enqueueDoorbells(env, [job()], origin, now); sqlite.exec("UPDATE workspaces SET paused=1 WHERE id='default'");
    await drain(now, noNetwork); assert.equal(row().status, "pending");
    sqlite.exec("UPDATE workspaces SET paused=0 WHERE id='default'"); await drain(now, noNetwork, { ...env, SERVICE_PAUSED: "true" }); assert.equal(row().status, "pending");
    await drain(now, async () => new Response(null, { status: 204 })); assert.equal(row().status, "delivered");
  });
  await check("broadcast selection and outbox deletion are workspace-scoped", async () => {
    fixture(); sqlite.exec("UPDATE jobs SET to_agent='*'"); await delivery.enqueueDoorbells(env, [job()], origin, now);
    assert.deepEqual(sqlite.prepare("SELECT agent_id FROM wake_deliveries").all().map((r) => r.agent_id), ["worker-1"]);
    sqlite.prepare("INSERT INTO wake_deliveries(workspace_id,job_id,agent_id,generation,next_attempt_at,created_at,updated_at) VALUES ('ws_other','other-job','worker-2',?,?,?,?)").run(now, now, now, now);
    await delivery.deleteWorkspaceDeliveries(env); assert.equal(sqlite.prepare("SELECT count(*) AS n FROM wake_deliveries WHERE workspace_id='ws_other'").get().n, 1);
  });
  console.log(`\n${checks} isolated delivery checks passed (no network requests).`);
} finally {
  sqlite.close(); await rm(temporary, { recursive: true, force: true });
}
