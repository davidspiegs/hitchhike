// Actual CLI subprocesses against synthetic loopback relays; no provider calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../cli/relay.mjs", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "hitchhike-cli-regression-"));
let checks = 0;
const active = new Set();
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, description) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timeout: ${description}`);
    await sleep(10);
  }
}

function files(directory, suffix) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name), suffix) : entry.name.endsWith(suffix) ? [join(directory, entry.name)] : []);
}

function job(id = "job-fixture") {
  const now = new Date().toISOString();
  return { id, title: `Synthetic ${id}`, type: "task", from: "sender", to: "worker", status: "claimed", goal: "Print a synthetic reply.", thread: [], attempts: 1, max_attempts: 3, lease: { holder: "worker", expires_at: new Date(Date.now() + 60000).toISOString() }, created_at: now, updated_at: now, result: null };
}

async function fixture(options = {}) {
  const directory = mkdtempSync(join(scratch, "case-"));
  const state = { polls: 0, beats: 0, submissions: 0, accepted: false, requests: [], claimedIds: [], ack: 0, pending: 0, options, directory };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const url = new URL(req.url, state.base);
    state.requests.push({ path: url.pathname, query: url.searchParams.toString(), headers: req.headers, body });
    const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    if (options.redirect && url.pathname === options.redirect.path) {
      res.writeHead(307, { location: options.redirect.to || `${state.base}/sink` }); res.end(); return;
    }
    if (url.pathname === "/v1/me") return send(200, { id: "worker", ...(options.targetedClaim === false ? {} : { capabilities: { targeted_claim: true } }) });
    if (url.pathname === "/v1/work/next") {
      state.polls++;
      const requestedId = url.searchParams.get("job_id");
      const queue = options.jobs || [job(options.jobId)];
      const selected = options.noJob ? null : queue.find((item) => !requestedId || item.id === requestedId);
      const item = selected ? { ...selected, attempts: options.attempts || 1, thread: options.thread || [] } : null;
      if (item) state.claimedIds.push(item.id);
      return send(200, { job: item, submit_url: options.submitUrl || `${state.base}/v1/submit${options.legacy ? "/ct_legacy" : ""}`, ...(options.legacy ? {} : { claim_id: `ct_fixture-${state.polls}` }), resent: options.resent || false, rules: [] });
    }
    if (url.pathname === "/v1/heartbeat" || url.pathname === "/v1/submit/ct_legacy/heartbeat") {
      state.beats++;
      if (options.holdHeartbeat) return;
      if (options.waitForChildReady && state.beats > 1) {
        await until(options.childReady || (() => state.count() === 1), "local child readiness before heartbeat fault");
        // Network-loss coverage starts its short known deadline only after the
        // child has actually run. Cold Node startup does not spend that window.
        if (options.heartbeatDrop && !state.failureLeaseIssued) {
          state.failureLeaseIssued = true;
          return send(200, { ok: true, lease_expires_at: new Date(Date.now() + 750).toISOString() });
        }
      }
      if (options.heartbeatFail && state.beats > 1) return send(409, { ok: false, error: { message: "lost claim" } });
      if (options.heartbeatDrop && state.beats > 1) return req.socket.destroy();
      return send(200, { ok: true, lease_expires_at: new Date(Date.now() + (options.waitForChildReady ? 6000 : options.leaseMs || 60000)).toISOString() });
    }
    if (url.pathname === "/v1/submit" || url.pathname === "/v1/submit/ct_legacy") {
      state.submissions++;
      if (options.dropBefore) return req.socket.destroy();
      if (!options.submitStatus || options.submitStatus === 200) state.accepted = true;
      if (options.dropAfter) return req.socket.destroy();
      if (options.holdAfter) return;
      if (options.malformed) { res.writeHead(200); return res.end("not-json"); }
      const status = options.submitStatus || 200;
      return send(status, options.response || (status === 200 ? { ok: true, outcome: body.startsWith("FAILED:") ? "RECORDED" : "ACCEPTED", message: "synthetic result stored" } : { ok: false, outcome: "NOT_ACCEPTED", message: `synthetic ${status}` }));
    }
    if (url.pathname === "/v1/inbox") {
      const since = Number(url.searchParams.get("cursor") || state.ack);
      const limit = Number(url.searchParams.get("limit") || 100);
      const total = options.inboxTotal || 0;
      const end = Math.min(total, since + limit);
      const arrived = Array.from({ length: Math.max(0, end - since) }, (_, i) => {
        const item = job(`delivery-${since + i + 1}`);
        item.status = "completed";
        item.completed_at = "2026-09-30T00:00:00.000Z";
        item.updated_at = item.completed_at; // Timestamp ties must not skip results.
        item.result = { worker: "worker", summary: `Result ${since + i + 1}`, body: options.largeOutput ? "x".repeat(1024 * 1024) : "Synthetic full body" };
        return item;
      });
      state.pending = Math.max(state.pending, end);
      return send(200, { arrived, pending: [], delivery_cursor: end, next_cursor: end, has_more: end < total });
    }
    if (url.pathname === "/v1/inbox/ack") {
      const cursor = JSON.parse(body).delivery_cursor;
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > state.pending) return send(400, { error: { message: "unseen cursor" } });
      if (options.ackFails) return send(503, { error: { message: "synthetic ack failure" } });
      state.ack = Math.max(state.ack, cursor);
      return send(200, { ok: true });
    }
    send(200, { ok: true, outcome: "ACCEPTED" }); // Redirect sink is observable in requests.
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.base = `http://127.0.0.1:${server.address().port}`;
  state.environment = { RELAY_URL: state.base, RELAY_TOKEN: "synthetic-worker-token", XDG_CONFIG_HOME: join(directory, "config") };
  state.counter = join(directory, "effects.json");
  const code = `const fs=require('node:fs'); const path=${JSON.stringify(state.counter)}; let n=0; try { n=JSON.parse(fs.readFileSync(path,'utf8')); } catch {} fs.writeFileSync(path,JSON.stringify(n+1)); process.stdout.write('## Summary\\nSynthetic result\\n'); ${options.slowCommand ? "setInterval(()=>{},1000);" : ""}`;
  state.command = `${quote(process.execPath)} -e ${quote(code)}`;
  state.count = () => { try { return Number(readFileSync(state.counter, "utf8")); } catch { return 0; } };
  state.receipts = () => files(state.environment.XDG_CONFIG_HOME, "receipt.json").map((path) => ({ path, data: JSON.parse(readFileSync(path, "utf8")) }));
  state.close = async () => {
    for (const receipt of state.receipts()) {
      if (receipt.data.child_pid) {
        try { process.kill(-receipt.data.child_pid, "SIGKILL"); } catch {}
      }
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  return state;
}

function start(f, args, { stdin = "", env = {}, brokenOutput = false } = {}) {
  const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, ...f.environment, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  active.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (part) => { stdout += part; });
  child.stderr.on("data", (part) => { stderr += part; });
  if (brokenOutput) child.stdout.destroy();
  child.stdin.end(stdin);
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`CLI timed out: ${args.join(" ")}\n${stderr}`)); }, 8000);
    child.once("error", reject);
    child.once("close", (code, signal) => { clearTimeout(timer); active.delete(child); resolve({ code, signal, stdout, stderr }); });
  });
  return { child, done, output: () => ({ stdout, stderr }) };
}
const run = (f, args, options) => start(f, args, options).done;
const runner = (f, extra = []) => ["run", "--exec", f.command, "--yes", "--once", ...extra];

async function test(name, options, body) {
  const f = await fixture(options);
  try { await body(f); checks++; process.stdout.write(`ok ${checks} - ${name}\n`); }
  finally { await f.close(); }
}

try {
  await test("unknown commands report one readable error without a stack trace", {}, async (f) => {
    const result = await run(f, ["unknown-fixture-command"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /^relay: unknown command/);
    assert.doesNotMatch(result.stderr, /at |CliError|file:\/\//);
  });
  for (const legacy of [false, true]) {
    await test(`${legacy ? "self-host" : "hosted"} runner submits with the correct heartbeat and credentials`, { legacy }, async (f) => {
      const result = await run(f, runner(f));
      assert.equal(result.code, 0, result.stderr);
      assert.equal(f.count(), 1);
      const beat = f.requests.find((request) => request.path.includes("heartbeat"));
      const submit = f.requests.find((request) => request.path === (legacy ? "/v1/submit/ct_legacy" : "/v1/submit"));
      assert.ok(beat && submit);
      assert.equal(beat.headers.authorization, legacy ? undefined : "Bearer synthetic-worker-token");
      assert.equal(submit.headers.authorization, legacy ? undefined : "Bearer synthetic-worker-token");
      assert.equal(submit.headers["x-claim-token"], legacy ? undefined : "ct_fixture-1");
      const receipt = f.receipts()[0];
      assert.equal(receipt.data.phase, "settled");
      assert.match(readFileSync(receipt.data.result_file, "utf8"), /Synthetic result/);
      if (process.platform !== "win32") {
        assert.equal(statSync(receipt.path).mode & 0o777, 0o600);
        assert.equal(statSync(resolve(receipt.path, "..")).mode & 0o777, 0o700);
      }
    });
    await test(`${legacy ? "self-host" : "hosted"} decline submits failure without executing`, { legacy }, async (f) => {
      const result = await run(f, ["run", "--exec", f.command, "--once"], { stdin: "n\n" });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(f.count(), 0);
      assert.equal(f.submissions, 1);
      assert.equal(f.receipts()[0].data.outcome, "RECORDED");
    });
  }
  await test("next prints the usable hosted claim flag", {}, async (f) => {
    const result = await run(f, ["next"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /--claim-id ct_fixture-1 --file result.md/);
  });
  await test("submit JSON errors still return a failing exit code", { submitStatus: 422 }, async (f) => {
    const result = await run(f, ["submit", `${f.base}/v1/submit`, "--claim-id", "ct_fixture-1", "--json"], { stdin: "## Summary\nSynthetic" });
    assert.notEqual(result.code, 0);
    assert.equal(JSON.parse(result.stdout).outcome, "NOT_ACCEPTED");
  });
  await test("standalone legacy submit never attaches the ambient bearer", { legacy: true }, async (f) => {
    const result = await run(f, ["submit", `${f.base}/v1/submit/ct_legacy`], { stdin: "## Summary\nSynthetic", env: { RELAY_URL: "" } });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(f.requests[0].headers.authorization, undefined);
  });
  await test("foreign submit URL is rejected before any command or credential leaves", {}, async (f) => {
    const sink = await fixture();
    try {
      f.options.submitUrl = `${sink.base}/v1/submit`;
      const result = await run(f, runner(f));
      assert.notEqual(result.code, 0);
      assert.equal(f.count(), 0);
      assert.equal(sink.requests.length, 0);
      const direct = await run(f, ["submit", `${sink.base}/v1/submit`, "--claim-id", "ct_fixture-1"], { stdin: "synthetic" });
      assert.notEqual(direct.code, 0);
      assert.equal(sink.requests.length, 0);
    } finally { await sink.close(); }
  });
  for (const foreign of [false, true]) await test(`${foreign ? "cross" : "same"}-origin redirects are never followed`, {}, async (f) => {
    const sink = await fixture();
    try {
      f.options.redirect = { path: "/v1/submit", to: `${foreign ? sink.base : f.base}/sink` };
      const result = await run(f, ["submit", `${f.base}/v1/submit`, "--claim-id", "ct_fixture-1"], { stdin: "synthetic" });
      assert.notEqual(result.code, 0);
      assert.equal(sink.requests.length, 0);
      assert.equal(f.requests.filter((request) => request.path === "/sink").length, 0);
    } finally { await sink.close(); }
  });
  await test("authenticated polling also refuses redirects", {}, async (f) => {
    f.options.redirect = { path: "/v1/work/next" };
    const result = await run(f, ["next"]);
    assert.notEqual(result.code, 0);
    assert.equal(f.requests.filter((request) => request.path === "/sink").length, 0);
  });
  for (const submitStatus of [401, 409, 422, 429, 500]) await test(`submission ${submitStatus} stops polling and restart cannot rerun`, { submitStatus }, async (f) => {
    const result = await run(f, ["run", "--exec", f.command, "--yes"]);
    assert.notEqual(result.code, 0);
    assert.equal(f.polls, 1);
    assert.equal(f.count(), 1);
    assert.match(readFileSync(f.receipts()[0].data.result_file, "utf8"), /Synthetic result/);
    f.options.attempts = 2; // A new lease can be resent:false after expiration.
    const restarted = await run(f, runner(f), { env: { RELAY_TOKEN: "rotated-synthetic-token" } });
    assert.notEqual(restarted.code, 0);
    assert.match(restarted.stderr, /--resume job-fixture/);
    assert.equal(f.count(), 1);
    assert.equal(f.submissions, 1);
  });
  for (const option of ["malformed", "dropBefore", "dropAfter"]) await test(`${option} response preserves output and prevents a repeated side effect`, { [option]: true }, async (f) => {
    const result = await run(f, runner(f));
    assert.notEqual(result.code, 0);
    const receipt = f.receipts()[0];
    assert.equal(receipt.data.phase, "output_saved");
    assert.match(readFileSync(receipt.data.stdout_file, "utf8"), /Synthetic result/);
    assert.equal(f.count(), 1);
    if (option === "dropAfter") assert.equal(f.accepted, true);
    const restarted = await run(f, runner(f));
    assert.notEqual(restarted.code, 0);
    assert.equal(f.count(), 1);
  });
  await test("a crash after the started receipt reclaims the dead lock but does not execute", { holdHeartbeat: true }, async (f) => {
    const first = start(f, runner(f));
    await until(() => f.beats === 1, "initial heartbeat after durable receipt");
    first.child.kill("SIGKILL");
    await first.done;
    f.options.holdHeartbeat = false;
    const restarted = await run(f, runner(f));
    assert.notEqual(restarted.code, 0);
    assert.match(restarted.stderr, /already claimed or executed/);
    assert.equal(f.count(), 0);
    assert.equal(files(f.environment.XDG_CONFIG_HOME, "runner.lock").length, 0);
  });
  await test("a crash after server acceptance preserves the result and never reruns", { holdAfter: true }, async (f) => {
    const first = start(f, runner(f));
    await until(() => f.accepted, "server acceptance");
    first.child.kill("SIGKILL");
    await first.done;
    assert.equal(f.receipts()[0].data.phase, "output_saved");
    const restarted = await run(f, runner(f));
    assert.notEqual(restarted.code, 0);
    assert.equal(f.count(), 1);
    assert.equal(f.submissions, 1);
  });
  await test("resent work with no journal requires explicit job-specific resume", { resent: true }, async (f) => {
    const stopped = await run(f, runner(f));
    assert.notEqual(stopped.code, 0);
    assert.equal(f.count(), 0);
    const resumed = await run(f, runner(f, ["--resume", "job-fixture"]));
    assert.equal(resumed.code, 0, resumed.stderr);
    assert.equal(f.count(), 1);
  });
  await test("resume constrains the claim before unrelated queued work can spend an attempt", { jobs: [job("unrelated-first"), job("job-fixture")] }, async (f) => {
    const result = await run(f, runner(f, ["--resume", "job-fixture"]));
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(f.claimedIds, ["job-fixture"]);
    assert.equal(f.count(), 1);
    const request = f.requests.find((item) => item.path === "/v1/work/next");
    assert.equal(new URLSearchParams(request.query).get("job_id"), "job-fixture");
  });
  await test("missing resume target leaves unrelated queued work unclaimed", { jobs: [job("unrelated-first")] }, async (f) => {
    const result = await run(f, runner(f, ["--resume", "missing-job"]));
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Nothing was executed/);
    assert.deepEqual(f.claimedIds, []);
    assert.equal(f.count(), 0);
    assert.equal(f.beats, 0);
  });
  await test("resume fails before polling a relay without targeted-claim capability", { targetedClaim: false }, async (f) => {
    const result = await run(f, runner(f, ["--resume", "job-fixture"]));
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /no job was claimed/);
    assert.equal(f.polls, 0);
    assert.equal(f.count(), 0);
    // Older relays continue to support ordinary, non-resume execution.
    const ordinary = await run(f, runner(f));
    assert.equal(ordinary.code, 0, ordinary.stderr);
    assert.equal(f.count(), 1);
  });
  await test("explicit resume supports a legitimate new Q&A/review round and preserves earlier output", {}, async (f) => {
    assert.equal((await run(f, runner(f))).code, 0);
    const previous = f.receipts()[0].data.result_file;
    f.options.attempts = 2;
    f.options.thread = [{ from: "sender", kind: "feedback", text: "Revise the synthetic reply.", at: new Date().toISOString() }];
    assert.notEqual((await run(f, runner(f))).code, 0);
    assert.equal(f.count(), 1);
    assert.notEqual((await run(f, runner(f, ["--resume", "different-job"]))).code, 0);
    assert.equal(f.count(), 1);
    const resumed = await run(f, runner(f, ["--resume", "job-fixture"]));
    assert.equal(resumed.code, 0, resumed.stderr);
    assert.equal(f.count(), 2);
    assert.match(readFileSync(previous, "utf8"), /Synthetic result/);
  });
  await test("concurrent runners cannot both execute the same job", { slowCommand: true }, async (f) => {
    const first = start(f, runner(f));
    await until(() => f.count() === 1, "first command start");
    const second = await run(f, runner(f));
    assert.notEqual(second.code, 0);
    assert.match(second.stderr, /holds this connection's lock/);
    assert.equal(f.count(), 1);
    first.child.kill("SIGTERM");
    const interrupted = await first.done;
    assert.notEqual(interrupted.code, 0);
    assert.equal(f.submissions, 0);
    assert.match(readFileSync(f.receipts()[0].data.stdout_file, "utf8"), /Synthetic result/);
  });
  for (const option of ["heartbeatFail", "heartbeatDrop"]) await test(`${option} stops the local command, retains partial output and does not submit`, { [option]: true, waitForChildReady: true, slowCommand: true }, async (f) => {
    const result = await run(f, runner(f));
    assert.notEqual(result.code, 0);
    assert.equal(f.count(), 1);
    assert.equal(f.submissions, 0);
    assert.match(readFileSync(f.receipts()[0].data.stdout_file, "utf8"), /Synthetic result/);
    assert.match(result.stderr, /local command was stopped/);
  });
  if (process.platform !== "win32") await test("lease loss escalates to SIGKILL even after a shell's redirected background child outlives it", { heartbeatFail: true, waitForChildReady: true }, async (f) => {
    const marker = join(f.directory, "background-effects");
    const background = `const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),10);`;
    f.options.childReady = () => { try { return statSync(marker).size > 0; } catch { return false; } };
    f.command = `${quote(process.execPath)} -e ${quote(background)} > /dev/null 2>&1 & sleep 30`;
    const result = await run(f, runner(f));
    assert.notEqual(result.code, 0);
    assert.equal(f.submissions, 0);
    const before = statSync(marker).size;
    assert.ok(before > 0, "background child ran before lease loss");
    await sleep(150);
    assert.equal(statSync(marker).size, before, "redirected SIGTERM-ignoring descendant stopped before runner returned");
  });
  await test("unwritable journal location prevents execution", {}, async (f) => {
    const notDirectory = join(f.directory, "not-a-directory");
    writeFileSync(notDirectory, "synthetic");
    const result = await run(f, runner(f), { env: { XDG_CONFIG_HOME: notDirectory } });
    assert.notEqual(result.code, 0);
    assert.equal(f.count(), 0);
    assert.equal(f.polls, 0);
  });
  await test("human inbox drains more than 100 tied-timestamp results before acknowledging", { inboxTotal: 205 }, async (f) => {
    const result = await run(f, ["inbox"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal((result.stdout.match(/Synthetic delivery-/g) || []).length, 205);
    assert.equal(f.ack, 205);
    assert.equal(f.requests.filter((request) => request.path === "/v1/inbox").length, 3);
    const next = await run(f, ["inbox"]);
    assert.match(next.stdout, /No unacknowledged results/);
  });
  await test("machine inbox never implicitly acknowledges and supports explicit repeat-safe ack", { inboxTotal: 205 }, async (f) => {
    const first = await run(f, ["inbox", "--json"]);
    assert.equal(first.code, 0, first.stderr);
    const data = JSON.parse(first.stdout);
    assert.equal(data.arrived.length, 205);
    assert.equal(data.delivery_cursor, 205);
    assert.equal(f.ack, 0);
    assert.equal(JSON.parse((await run(f, ["inbox", "--json"])).stdout).arrived.length, 205);
    assert.notEqual((await run(f, ["inbox-ack", "206"])).code, 0);
    assert.equal((await run(f, ["inbox-ack", "205"])).code, 0);
    assert.equal((await run(f, ["inbox-ack", "205", "--json"])).code, 0);
    assert.equal(JSON.parse((await run(f, ["inbox", "--json"])).stdout).arrived.length, 0);
  });
  await test("human --no-ack retains results and shows the explicit cursor", { inboxTotal: 2 }, async (f) => {
    const result = await run(f, ["inbox", "--no-ack"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(f.ack, 0);
    assert.match(result.stdout, /relay inbox-ack 2/);
  });
  await test("broken stdout does not acknowledge an inbox page", { inboxTotal: 1, largeOutput: true }, async (f) => {
    const result = await run(f, ["inbox"], { brokenOutput: true });
    assert.notEqual(result.code, 0, result.stderr);
    assert.equal(f.ack, 0);
    assert.equal(JSON.parse((await run(f, ["inbox", "--json"])).stdout).arrived.length, 1);
  });
  await test("failed acknowledgement stops paging and leaves the page retryable", { inboxTotal: 101, ackFails: true }, async (f) => {
    const result = await run(f, ["inbox"]);
    assert.notEqual(result.code, 0);
    assert.equal(f.ack, 0);
    assert.equal(f.requests.filter((request) => request.path === "/v1/inbox").length, 1);
  });
  process.stdout.write(`CLI regressions: ${checks} passed.\n`);
} finally {
  for (const child of active) child.kill("SIGKILL");
  rmSync(scratch, { recursive: true, force: true });
}
