#!/usr/bin/env node
// End-to-end tests against a running relay (default: `npm run dev` on :8787).
// Uses fresh agent ids each run, so it can run repeatedly against the same database.
//   RELAY_URL=http://127.0.0.1:8787 ADMIN_TOKEN=dev-admin-token node scripts/e2e.mjs

const BASE = (process.env.RELAY_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin-token";
const run = Math.random().toString(36).slice(2, 6).replace(/[0-9]/g, "x");
const id = (name) => `${name}-${run}`;

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, { token, body, raw, type, json = true } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (json) headers.accept = "application/json";
  let payload;
  if (raw !== undefined) {
    payload = raw;
    headers["content-type"] = type || "text/markdown";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, text, data };
}
const admin = (method, path, body) => req(method, path, { token: ADMIN, body });

const created = [];
async function addAgent(spec) {
  const r = await admin("POST", "/v1/admin/agents", { ...spec, id: id(spec.id) });
  eq(r.status, 201, `create agent ${spec.id}`);
  created.push(r.data.agent.id);
  return { id: r.data.agent.id, agent: r.data.agent, token: r.data.token, setup: r.data.setup };
}
async function post(agent, job, extra = {}) {
  return req("POST", "/v1/jobs", { token: agent.token, body: job, ...extra });
}
async function nextJson(agent) {
  return req("POST", "/v1/work/next?format=json", { token: agent.token });
}
async function nextText(agent) {
  return req("POST", `/v1/work/next?key=${agent.token}`, { json: false });
}
async function submit(url, raw, type = "text/markdown") {
  return req("POST", url.replace(BASE, ""), { raw, type, json: false });
}
async function getJob(agent, jobId, full = false) {
  return req("GET", `/v1/jobs/${jobId}${full ? "?full=1" : ""}`, { token: agent.token });
}

const schema = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      minItems: 1,
      items: { type: "object", required: ["claim", "url"], properties: { claim: { type: "string" }, url: { type: "string" } } },
    },
  },
};

console.log(`Relay e2e against ${BASE} (run ${run})`);
let codex, grok, muse, runner, tiny, lazy, both;

await test("health check", async () => {
  const r = await req("GET", "/healthz");
  eq(r.status, 200, "status");
  eq(r.data.ok, true, "ok");
});

// Workers only take jobs from this run's requesters, so other data on the relay can't interfere.
const ours = [id("codex"), id("tiny"), id("both"), "owner"];

await test("owner connects agents and gets setup text", async () => {
  codex = await addAgent({ id: "codex", name: "Codex", can_request: true });
  grok = await addAgent({ id: "grok", name: "Grok Bot", can_work: true, work_types: ["research", "summarize", "monitor"], accept_from: ours });
  muse = await addAgent({ id: "muse", name: "Muse", can_work: true, work_types: ["research", "summarize", "digest"], poll_minutes: 15, accept_from: ours });
  runner = await addAgent({ id: "runner", name: "Local runner", can_work: true, work_types: ["build"], accept_from: ours });
  tiny = await addAgent({ id: "tiny", can_request: true, daily_job_limit: 2, request_targets: [id("grok")] });
  lazy = await addAgent({ id: "lazy", can_work: true, work_types: ["summarize"], daily_work_limit: 1, accept_from: ours });
  both = await addAgent({ id: "both", can_request: true, can_work: true, work_types: ["review"], accept_from: ours });
  assert(grok.setup.includes(`${BASE}/v1/work/next`) && grok.setup.includes("Authorization: Bearer " + grok.token), "worker setup uses the polling endpoint with a bearer header");
  assert(!grok.setup.includes("/v1/work/next?key="), "new worker setup keeps credentials out of polling URLs");
  eq(muse.agent.poll_minutes, 15, "saved polling metadata is preserved");
  assert(!muse.setup.includes("Create a scheduled task"), "generic agent setup does not request a schedule by default");
  assert(codex.setup.includes("Authorization: Bearer " + codex.token), "requester setup has header");
  const again = await admin("POST", "/v1/admin/agents", { id: grok.id, daily_work_limit: 40 });
  eq(again.status, 200, "update existing agent");
  eq(again.data.token, null, "no new token on plain update");
});

let research;
await test("requester creates a research job; same idempotency key returns the same job", async () => {
  const job = {
    type: "research",
    to: grok.id,
    title: "Public complaints about coding-agent usage limits",
    goal: "Find public complaints from the last 30 days about usage limits in Codex and Claude Code. Cluster them by theme.",
    inputs: { window_days: 30, products: ["Codex", "Claude Code"] },
    constraints: ["Public sources only", "Max 20 sources"],
    acceptance: ["Every finding has a URL"],
    output: { format: "json", schema },
    idempotency_key: `limits-${run}`,
  };
  const r = await post(codex, job);
  eq(r.status, 201, "create");
  eq(r.data.job.status, "queued", "status");
  eq(r.data.job.from, codex.id, "from is stamped from the token");
  research = r.data.job;
  const replay = await post(codex, job);
  eq(replay.status, 200, "replay status");
  eq(replay.data.job.id, research.id, "same job id");
  eq(replay.data.replay, true, "replay flag");
});

await test("a job addressed to grok is invisible to muse", async () => {
  const r = await nextText(muse);
  eq(r.status, 200, "status");
  assert(r.text.startsWith("NO_JOBS"), `expected NO_JOBS, got: ${r.text.slice(0, 80)}`);
  eq((await getJob(muse, research.id)).status, 404, "muse can't read grok's job");
});

let submitUrl;
await test("worker claims the job as readable markdown with a submit URL", async () => {
  const r = await nextText(grok);
  eq(r.status, 200, "status");
  assert(r.text.includes("# Job: Public complaints"), "title rendered");
  assert(r.text.includes("## Rules for this job"), "rules rendered");
  assert(r.text.includes("The JSON must match this schema"), "schema rendered");
  submitUrl = r.text.match(/(https?:\/\/\S+\/v1\/submit\/ct_[\w-]+)/)?.[1];
  assert(submitUrl, "submit URL present");
});

await test("polling again while holding the lease returns the same job, not a new one", async () => {
  const r = await nextJson(grok);
  eq(r.data.job.id, research.id, "same job");
  eq(r.data.resent, true, "resent flag");
  eq(r.data.job.status, "claimed", "still claimed");
  assert(r.data.submit_url !== submitUrl, "fresh submit URL");
});

await test("a result missing the requested JSON bounces back with instructions", async () => {
  const r = await submit(submitUrl, "## Summary\nLots of people are unhappy.\n\n## Sources\nhttps://example.com/a");
  eq(r.status, 422, "status");
  assert(r.text.startsWith("NOT_ACCEPTED"), r.text.slice(0, 60));
  assert(r.text.includes("json code block"), "explains what's missing");
});

await test("a schema violation bounces back naming the field", async () => {
  const bad = "## Summary\nTwo themes.\n\n```json\n{\"findings\": [{\"claim\": \"limits hit fast\"}]}\n```";
  const r = await submit(submitUrl, bad);
  eq(r.status, 422, "status");
  assert(/url/.test(r.text), `names the missing field: ${r.text}`);
  assert(r.text.includes("next submission will be accepted as-is"), "last warning");
});

await test("a valid markdown result is accepted; resubmitting is a harmless no-op", async () => {
  const good = [
    "## Summary",
    "Two themes dominate: weekly caps arriving mid-task, and opaque accounting.",
    "",
    "```json",
    JSON.stringify({ findings: [{ claim: "Weekly cap hit mid-refactor", url: "https://github.com/openai/codex/issues/14593" }] }),
    "```",
    "",
    "## Sources",
    "- [Codex issue 14593](https://github.com/openai/codex/issues/14593)",
    "- https://news.ycombinator.com/item?id=1",
  ].join("\n");
  const r = await submit(submitUrl, good);
  eq(r.status, 200, "status");
  assert(r.text.startsWith("ACCEPTED"), r.text.slice(0, 60));
  const again = await submit(submitUrl, good);
  eq(again.status, 200, "resubmit status");
  assert(again.text.startsWith("ALREADY_DONE"), again.text.slice(0, 60));
});

await test("requester reads a compact, typed, provenance-stamped result", async () => {
  const r = await getJob(codex, research.id);
  const job = r.data.job;
  eq(job.status, "completed", "status");
  eq(job.result.worker, grok.id, "worker stamped");
  eq(job.result.provenance.untrusted, true, "untrusted flag");
  eq(job.result.data.findings.length, 1, "typed data");
  assert(job.result.summary.startsWith("Two themes"), "summary extracted");
  assert(!job.result.summary.includes("```") && !job.result.summary.includes("findings"), `summary stops before the json block: ${job.result.summary}`);
  eq(job.result.sources.length, 2, "sources extracted");
  eq(job.result.sources[0].title, "Codex issue 14593", "link title kept");
  eq(job.result.body, undefined, "body omitted by default");
  assert(job.result.body_chars > 100, "body size reported");
  const full = await getJob(codex, research.id, true);
  assert(full.data.job.result.body.includes("## Sources"), "full body on request");
});

await test("permission and envelope rules", async () => {
  const forbiddenSend = await post(muse, { type: "research", to: grok.id, title: "x", goal: "y" });
  eq(forbiddenSend.status, 403, "worker-only connection cannot send jobs");
  eq(forbiddenSend.data.error.code, "insufficient_scope", "send permission is enforced before the operation");
  eq((await post(codex, { type: "build", to: grok.id, title: "x", goal: "y" })).data.error.code, "type_not_accepted", "type check");
  eq((await post(codex, { type: "research", to: grok.id, title: "x", goal: "y", reply_to: "https://evil.example" })).data.error.code, "routing_not_allowed", "no reply_to");
  eq((await post(codex, { type: "research", to: grok.id, title: "x", goal: "y", from: "owner" })).data.error.code, "from_not_allowed", "no from");
  eq((await post(codex, { type: "research", to: grok.id, title: "x", goal: "y", colour: 1 })).status, 400, "unknown field");
  eq((await post(codex, { type: "research", to: "nobody", title: "x", goal: "y" })).data.error.code, "unknown_worker", "unknown worker");
  eq((await post(tiny, { type: "research", to: muse.id, title: "x", goal: "y" })).data.error.code, "target_not_allowed", "target allowlist");
  const stranger = await addAgent({ id: "stranger", can_request: true });
  eq((await post(stranger, { type: "research", to: grok.id, title: "x", goal: "y" })).data.error.code, "sender_not_accepted", "worker's sender allowlist");
  eq((await req("POST", "/v1/jobs", { body: { type: "research" } })).status, 401, "no token");
  eq((await req("GET", `/v1/admin/overview?key=${ADMIN}`)).status, 401, "owner token not accepted in the URL");
});

await test("daily job budget is enforced, and requesters can cancel", async () => {
  const a = await post(tiny, { type: "summarize", to: grok.id, title: "budget 1", goal: "Summarize https://example.com" });
  const b = await post(tiny, { type: "summarize", to: grok.id, title: "budget 2", goal: "Summarize https://example.com" });
  eq(a.status, 201, "first");
  eq(b.status, 201, "second");
  const c = await post(tiny, { type: "summarize", to: grok.id, title: "budget 3", goal: "Summarize https://example.com" });
  eq(c.status, 429, "third is over budget");
  for (const j of [a, b]) eq((await req("POST", `/v1/jobs/${j.data.job.id}/cancel`, { token: tiny.token })).data.job.status, "canceled", "cancel");
});

await test("expired claims cannot submit or renew; only the current attempt can complete reassigned work", async () => {
  const r = await post(codex, { type: "research", to: "*", title: "Lease test", goal: "Anything.", lease_seconds: 2 });
  eq(r.status, 201, "create");
  const jobId = r.data.job.id;
  const g = await nextJson(grok);
  eq(g.data.job.id, jobId, "grok claims it");
  await sleep(2300);

  // These calls happen before any sweep or another worker's claim.
  const expired = await submit(g.data.submit_url, "## Summary\nThis attempt has expired.");
  eq(expired.status, 409, "expired submission is rejected before reassignment");
  const heartbeat = await req("POST", g.data.submit_url.replace(BASE, "") + "/heartbeat");
  eq(heartbeat.status, 409, "an expired claim cannot renew its lease");
  eq(heartbeat.data.ok, false, "expired heartbeat reports no ownership");
  const expiredForm = await req("GET", g.data.form_url.replace(BASE, ""), { json: false });
  eq(expiredForm.status, 404, "expired browser capability no longer exposes the brief");

  const m = await nextJson(muse);
  eq(m.data.job.id, jobId, "muse gets it after the lease lapses");
  eq(m.data.job.attempts, 2, "attempt 2");
  const staleAttempts = await Promise.all([
    submit(g.data.submit_url, "## Summary\nGrok finished late but finished."),
    submit(g.data.submit_url, "NEEDS_INPUT: Reopen this old attempt?"),
    submit(g.data.submit_url, "FAILED: The old attempt gave up."),
  ]);
  for (const [i, result] of staleAttempts.entries()) eq(result.status, 409, `stale completion/question/failure ${i + 1} rejected`);
  const active = await getJob(codex, jobId);
  eq(active.data.job.status, "claimed", "stale attempts did not change the current work");
  eq(active.data.job.lease.holder, muse.id, "current worker retains its lease");
  assert(!active.data.job.thread.some((entry) => entry.text.includes("Reopen this old attempt")), "stale question did not enter the thread");

  const current = await submit(m.data.submit_url, "## Summary\nMuse's answer.");
  eq(current.status, 200, "current result accepted");
  assert(current.text.startsWith("ACCEPTED"), current.text);
  const retry = await submit(m.data.submit_url, "## Summary\nMuse's answer.");
  assert(retry.text.startsWith("ALREADY_DONE"), "completed current attempt retries remain harmless");
  const finished = (await getJob(codex, jobId)).data.job;
  eq(finished.result.worker, muse.id, "only the current worker's result is kept");
  eq(finished.result.summary, "Muse's answer.", "stale content never replaced the accepted result");
});

let build;
await test("build jobs wait for owner approval before anyone can claim them", async () => {
  const r = await post(codex, {
    type: "build",
    to: runner.id,
    title: "Fix the broken footer link",
    goal: "The footer 'Contact' link 404s. Point it at /contact and open a PR.",
    inputs: { repo: "github.com/example/site", base: "main" },
  });
  eq(r.data.job.status, "needs_approval", "held for approval");
  build = r.data.job;
  assert((await nextText(runner)).text.startsWith("NO_JOBS"), "not claimable yet");
  eq((await req("POST", `/v1/jobs/${build.id}/approve`, { token: codex.token })).status, 403, "requester can't self-approve");
  eq((await admin("POST", `/v1/jobs/${build.id}/approve`)).data.job.status, "queued", "owner approves");
});

await test("worker asks a question; requester answers; old claim is stale; job returns with the answer", async () => {
  const first = await nextJson(runner);
  eq(first.data.job.id, build.id, "runner claims build");
  const q = await submit(first.data.submit_url, "NEEDS_INPUT: Should the PR target main or develop?");
  assert(q.text.startsWith("QUESTION_SENT"), q.text);
  eq((await getJob(codex, build.id)).data.job.status, "input_required", "input required");
  const a = await req("POST", `/v1/jobs/${build.id}/reply`, { token: codex.token, body: { message: "Target main." } });
  eq(a.data.job.status, "queued", "back in queue");
  const stale = await submit(first.data.submit_url, "## Summary\nDone on develop.");
  eq(stale.status, 409, "old claim is stale");
  const second = await nextText(runner);
  assert(second.text.includes("**codex-") && second.text.includes("answered: Target main."), "answer shown in job");
  const url = second.text.match(/(https?:\/\/\S+\/v1\/submit\/ct_[\w-]+)/)[1];
  const done = await submit(url, JSON.stringify({ summary: "Opened PR #12 against main.", data: { pr_url: "https://github.com/example/site/pull/12" } }), "application/json");
  assert(done.text.startsWith("ACCEPTED"), done.text);
});

await test("requester sends a result back with feedback; the retry sees it", async () => {
  const back = await req("POST", `/v1/jobs/${build.id}/reject`, { token: codex.token, body: { feedback: "Also fix the same link in the header." } });
  eq(back.data.job.status, "queued", "requeued");
  eq(back.data.job.result, null, "old result cleared");
  const again = await nextText(runner);
  assert(again.text.includes("sent it back with feedback: Also fix the same link in the header."), "feedback visible");
  const url = again.text.match(/(https?:\/\/\S+\/v1\/submit\/ct_[\w-]+)/)[1];
  assert((await submit(url, "## Summary\nFixed header and footer. PR #12 updated.")).text.startsWith("ACCEPTED"), "accepted");
  eq((await req("POST", `/v1/jobs/${build.id}/accept`, { token: codex.token })).status, 200, "accept");
});

await test("canceled jobs are never handed out", async () => {
  const r = await post(codex, { type: "digest", to: muse.id, title: "Cancel me", goal: "Digest." });
  await req("POST", `/v1/jobs/${r.data.job.id}/cancel`, { token: codex.token });
  assert((await nextText(muse)).text.startsWith("NO_JOBS"), "nothing to do");
});

await test("browser-only agents can use the claim link as a form", async () => {
  const r = await post(codex, { type: "summarize", to: muse.id, title: "Form fallback", goal: "Summarize https://example.com." });
  const claim = await nextJson(muse);
  eq(claim.data.job.id, r.data.job.id, "claimed");
  const page = await req("GET", claim.data.form_url.replace(BASE, ""), { json: false });
  eq(page.status, 200, "form page");
  assert(page.text.includes('name="result"') && page.text.includes("Form fallback"), "has the form and job");
  const form = await submit(claim.data.submit_url, "result=" + encodeURIComponent("## Summary\nExample domain page."), "application/x-www-form-urlencoded");
  eq(form.status, 200, "form submit");
  assert(form.text.includes("Accepted"), "html confirmation");
  eq((await getJob(codex, r.data.job.id)).data.job.status, "completed", "completed");
});

await test("heartbeat extends a lease; FAILED records a clean failure", async () => {
  const r = await post(codex, { type: "research", to: grok.id, title: "Heartbeat", goal: "Anything.", lease_seconds: 30 });
  const c = await nextJson(grok);
  eq(c.data.job.id, r.data.job.id, "claimed");
  const before = Date.parse(c.data.job.lease.expires_at);
  await sleep(1100);
  const hb = await req("POST", c.data.submit_url.replace(BASE, "") + "/heartbeat", {});
  eq(hb.status, 200, "heartbeat");
  assert(Date.parse(hb.data.lease_expires_at) > before, "lease extended");
  const f = await submit(c.data.submit_url, "FAILED: The site blocks automated access.");
  assert(f.text.startsWith("RECORDED"), f.text);
  const job = (await getJob(codex, r.data.job.id)).data.job;
  eq(job.status, "failed", "failed");
  eq(job.error, "The site blocks automated access.", "reason kept");
});

await test("schedules create one job per slot and pass `since` to the next run", async () => {
  const s = await admin("POST", "/v1/admin/schedules", {
    id: `mentions-${run}`,
    every_minutes: 1440,
    from: codex.id,
    template: { type: "monitor", to: grok.id, title: "New mentions of the project", goal: "Check X and HN for new mentions since the last run." },
  });
  eq(s.status, 200, "saved");
  const t1 = await admin("POST", "/v1/admin/tick");
  eq(t1.data.created.length, 1, "one job created");
  eq((await admin("POST", "/v1/admin/tick")).data.created.length, 0, "no duplicate on a second tick");
  const first = await nextJson(grok);
  eq(first.data.job.id, t1.data.created[0], "grok gets the scheduled job");
  eq(first.data.job.from, codex.id, "sent on codex's behalf");
  eq(first.data.job.inputs.since, null, "first run has no since");
  await submit(first.data.submit_url, JSON.stringify({ summary: "Nothing new." }), "application/json");
  await admin("POST", "/v1/admin/schedules", {
    id: `mentions-${run}`,
    every_minutes: 1440,
    from: codex.id,
    start_in_minutes: 0,
    template: { type: "monitor", to: grok.id, title: "New mentions of the project", goal: "Check X and HN for new mentions since the last run." },
  });
  const t2 = await admin("POST", "/v1/admin/tick");
  eq(t2.data.created.length, 1, "second run");
  const second = await nextJson(grok);
  eq(second.data.job.inputs.previous_job_id, t1.data.created[0], "links the previous run");
  assert(second.data.job.inputs.since, "since is set");
  await submit(second.data.submit_url, "## Summary\nOne new mention on HN.");
  await admin("DELETE", `/v1/admin/schedules/mentions-${run}`);
});

await test("daily work limit caps how much a worker takes", async () => {
  await post(codex, { type: "summarize", to: lazy.id, title: "Lazy 1", goal: "One." });
  await post(codex, { type: "summarize", to: lazy.id, title: "Lazy 2", goal: "Two." });
  const c = await nextJson(lazy);
  await submit(c.data.submit_url, "## Summary\nDone.");
  eq((await nextJson(lazy)).data.reason, "daily_limit", "second is over the limit");
});

await test("an agent never claims its own broadcast", async () => {
  const peer = await addAgent({ id: "peer", can_work: true, work_types: ["review"], accept_from: [both.id] });
  const r = await post(both, { type: "review", to: "*", title: "Review my plan", goal: "Review it." });
  eq(r.status, 201, "broadcast accepted: peer takes reviews");
  const mine = await nextJson(both);
  assert(!mine.data.job || mine.data.job.id !== r.data.job.id, "the sender doesn't get its own job");
  const theirs = await nextJson(peer);
  eq(theirs.data.job.id, r.data.job.id, "peer gets it");
  assert((await submit(theirs.data.submit_url, "## Summary\nLooks fine.")).text.startsWith("ACCEPTED"), "accepted");
});

await test("disconnecting an agent revokes its key and closes out its work", async () => {
  const temp = await addAgent({ id: "temp", can_work: true, work_types: ["summarize"], accept_from: [codex.id] });
  const r = await post(codex, { type: "summarize", to: temp.id, title: "Orphaned job", goal: "Summarize." });
  eq((await admin("DELETE", `/v1/admin/agents/${temp.id}`)).status, 200, "deleted");
  eq((await nextJson(temp)).status, 401, "key revoked");
  const job = (await getJob(codex, r.data.job.id)).data.job;
  eq(job.status, "canceled", "its job was canceled");
  created.splice(created.indexOf(temp.id), 1);
});

let presetToken;
await test("platform presets fill in sensible defaults and a platform-specific guide", async () => {
  const r = await admin("POST", "/v1/admin/agents", { id: id("preset"), name: "Muse", platform: "muse", accept_from: ours });
  eq(r.status, 201, "created");
  created.push(r.data.agent.id);
  eq(r.data.agent.can_work, true, "takes jobs");
  eq(r.data.agent.poll_minutes, null, "creating Muse does not install a schedule");
  assert(r.data.agent.work_types.includes("digest"), "muse defaults include digest");
  assert(r.data.guide.steps.some((st) => st.copy && st.copy.includes(r.data.token)), "guide includes the key");
  eq(r.data.guide.platform, "muse", "guide belongs to the chosen provider");
  assert(r.data.guide.backgroundGuide.where.includes("Upcoming"), "provider guide names the recurring-task controls");
  eq(r.data.guide.backgroundSelection.intervalMinutes, 10, "Muse asks for ten-minute checks");
  assert(r.data.guide.steps.some(st => st.copy?.includes("every 10 minutes")), "the pairing paste includes the requested schedule");
  presetToken = r.data.token;
  const cc = await admin("POST", "/v1/admin/agents", { id: id("cc"), name: "Claude Code", platform: "claude-code" });
  created.push(cc.data.agent.id);
  eq(cc.data.agent.can_request, true, "claude code sends jobs");
  assert(cc.data.guide.steps[0].copy.startsWith("claude mcp add --scope user --transport http hitchhike"), "one-command MCP setup");
});

await test("setup instructions can be reopened; a new key replaces the old one", async () => {
  const first = await admin("GET", `/v1/admin/agents/${id("preset")}/setup`);
  eq(first.status, 200, "setup reopens");
  assert(presetToken && JSON.stringify(first.data.guide).includes(presetToken), "reopened self-hosted setup recovers the existing credential");
  const oldKey = presetToken;
  const rotated = await admin("POST", "/v1/admin/agents", { id: id("preset"), rotate_token: true });
  eq(rotated.status, 200, "rotation updates the existing connection");
  assert(rotated.data.token && rotated.data.token !== oldKey, "rotation creates a distinct credential");
  const after = await admin("GET", `/v1/admin/agents/${id("preset")}/setup`);
  const text = JSON.stringify(after.data.guide);
  assert(text.includes(rotated.data.token) && !text.includes(oldKey), "shows the new key only");
  eq((await req("POST", "/v1/work/next?format=json", { token: oldKey })).status, 401, "old bearer credential stops working");
  eq((await req("POST", `/v1/work/next?key=${oldKey}&format=json`)).status, 401, "rotation also revokes the legacy URL credential");
  eq((await req("GET", "/v1/me", { token: rotated.data.token })).data.id, id("preset"), "new credential authenticates the original connection");
});

const mcp = async (token, body, path = "/mcp") => {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: res.status === 202 ? null : await res.json().catch(() => null) };
};
const modern = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "1" } };
const callTool = async (token, name, args) =>
  (await mcp(token, { jsonrpc: "2.0", id: `${name}-${Math.random()}`, method: "tools/call", params: { name, arguments: args, _meta: modern } })).data.result;

await test("MCP: legacy handshake works and each role sees only its tools", async () => {
  const init = await mcp(codex.token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
  eq(init.status, 200, "initialize");
  eq(init.data.result.protocolVersion, "2025-06-18", "echoes a supported legacy version");
  assert(init.data.result.instructions.includes(codex.id), "instructions name the agent");
  eq((await mcp(codex.token, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202, "notification accepted");
  const requester = (await mcp(codex.token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).data.result.tools.map((t) => t.name);
  assert(requester.includes("send_job") && requester.includes("check_inbox") && !requester.includes("get_next_job"), `requester tools: ${requester}`);
  const worker = (await mcp(grok.token, { jsonrpc: "2.0", id: 3, method: "tools/list" })).data.result.tools.map((t) => t.name);
  assert(worker.includes("get_next_job") && worker.includes("submit_result") && !worker.includes("send_job"), `worker tools: ${worker}`);
});

await test("MCP: modern discovery, version errors, and auth", async () => {
  const d = await mcp(codex.token, { jsonrpc: "2.0", id: "d", method: "server/discover", params: { _meta: modern } });
  assert(d.data.result.supportedVersions.includes("2026-07-28"), "advertises the modern version");
  eq(d.data.result.resultType, "complete", "modern result type");
  const bad = await mcp(codex.token, { jsonrpc: "2.0", id: "x", method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" } } });
  eq(bad.data.error.code, -32022, "unsupported version error");
  eq((await mcp(null, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401, "no key");
  eq((await mcp(null, { jsonrpc: "2.0", id: 1, method: "tools/list" }, `/mcp/${codex.token}`)).status, 200, "key in the path works");
});

await test("MCP: send, pick up, submit, and read a job entirely through tools", async () => {
  const agents = await callTool(codex.token, "list_agents", {});
  assert(agents.content[0].text.includes(grok.id), "lists grok");
  const sent = await callTool(codex.token, "send_job", { to: grok.id, type: "research", title: "MCP round trip", task: "Find one fact about message relays." });
  assert(!sent.isError, sent.content[0].text);
  const jobId = sent.content[0].text.match(/job_[a-z0-9]+/)[0];
  const waiting = await callTool(codex.token, "check_inbox", {});
  assert(waiting.content[0].text.includes("Still in progress") && waiting.content[0].text.includes("MCP round trip"), "shows it pending");
  const next = await callTool(grok.token, "get_next_job", {});
  assert(next.content[0].text.includes("call submit_result"), "MCP-flavored brief");
  const claim = next.content[0].text.match(/ct_[\w-]+/)[0];
  eq((await callTool(grok.token, "submit_result", { claim_id: "ct_nope", result: "## Summary\nx" })).isError, true, "bad claim is an error");
  const done = await callTool(grok.token, "submit_result", { claim_id: claim, result: "## Summary\nRelays hold messages until the recipient checks in.\n\n## Sources\n- https://example.com/relays" });
  assert(done.content[0].text.startsWith("ACCEPTED"), done.content[0].text);
  const inbox = await callTool(codex.token, "check_inbox", {});
  assert(inbox.content[0].text.includes("Relays hold messages") && inbox.content[0].text.includes("written by other agents"), "result with provenance");
  const repeated = await callTool(codex.token, "check_inbox", {});
  assert(repeated.content[0].text.includes("Relays hold messages"), "unacknowledged results repeat until received");
  const deliveryCursor = Number(inbox.content[0].text.match(/delivery_cursor: (\d+)/)?.[1]);
  assert(Number.isSafeInteger(deliveryCursor) && deliveryCursor > 0, "inbox supplies a durable delivery cursor");
  const acknowledged = await callTool(codex.token, "acknowledge_results", { delivery_cursor: deliveryCursor });
  assert(!acknowledged.isError, "the delivered page can be acknowledged");
  const acknowledgedAgain = await callTool(codex.token, "acknowledge_results", { delivery_cursor: deliveryCursor });
  assert(!acknowledgedAgain.isError, "repeating acknowledgement is harmless");
  const afterAcknowledgement = await callTool(codex.token, "check_inbox", {});
  assert(afterAcknowledgement.content[0].text.startsWith("No unacknowledged"), "acknowledged results disappear from new deliveries");
  assert(!afterAcknowledgement.content[0].text.includes("Relays hold messages"), "the acknowledged result is not repeated");
  assert((await callTool(codex.token, "get_job", { job_id: jobId, full: true })).content[0].text.includes("Full write-up"), "full body on request");
  eq((await callTool(codex.token, "send_job", { to: "nobody", type: "research", title: "x", task: "y" })).isError, true, "helpful tool error");
});

await test("the owner can send a job to any agent, even one with a sender allowlist", async () => {
  const strict = await addAgent({ id: "strict", can_work: true, work_types: ["summarize"], accept_from: [codex.id] });
  const r = await admin("POST", "/v1/jobs", { type: "summarize", to: strict.id, title: "From the owner", goal: "Summarize https://example.com." });
  eq(r.status, 201, "owner job accepted");
  eq(r.data.job.from, "owner", "sent as owner");
  eq((await nextJson(strict)).data.job.id, r.data.job.id, "worker receives it");
});

await test("jobs for different agents never wait on each other; one agent can hold several at once", async () => {
  const duo = await addAgent({ id: "duo", can_work: true, work_types: ["summarize"], max_leases: 2, accept_from: [codex.id] });
  const solo = await addAgent({ id: "solo", can_work: true, work_types: ["summarize"], accept_from: [codex.id] });
  const ids = [];
  for (const n of [1, 2, 3]) ids.push((await post(codex, { type: "summarize", to: duo.id, title: `Parallel ${n}`, goal: "Summarize." })).data.job.id);
  const soloJob = (await post(codex, { type: "summarize", to: solo.id, title: "Meanwhile", goal: "Summarize." })).data.job.id;
  eq((await nextJson(solo)).data.job.id, soloJob, "another agent's job is picked up independently");
  const a = await nextJson(duo);
  const b = await nextJson(duo);
  const c = await nextJson(duo);
  eq(a.data.job.id, ids[0], "first job");
  eq(b.data.job.id, ids[1], "second job at the same time");
  eq(c.data.resent, true, "at its limit, it gets a job it already holds rather than a third");
  await submit(a.data.submit_url, "## Summary\nDone one.");
  eq((await nextJson(duo)).data.job.id, ids[2], "third job once a slot frees up");
});

await test("the ChatGPT preset connects over MCP with the key in the URL", async () => {
  const r = await admin("POST", "/v1/admin/agents", { id: id("gpt"), platform: "chatgpt" });
  eq(r.status, 201, "created");
  created.push(r.data.agent.id);
  eq(r.data.agent.name, "ChatGPT", "named after the platform");
  eq(r.data.agent.poll_minutes, null, "takes jobs when asked");
  assert(r.data.agent.can_request && r.data.agent.can_work, "sends and takes jobs");
  assert(r.data.guide.steps.some((st) => st.copy === `${BASE}/mcp/${r.data.token}`), "MCP URL with the key");
  const suppliedUrl = r.data.guide.steps.find((st) => st.copy === `${BASE}/mcp/${r.data.token}`).copy;
  const connected = await mcp(null, { jsonrpc: "2.0", id: "preset-discovery", method: "tools/list" }, new URL(suppliedUrl).pathname);
  eq(connected.status, 200, "the supplied self-hosted MCP URL works without an additional auth header");
  assert(connected.data.result.tools.some((tool) => tool.name === "send_job") && connected.data.result.tools.some((tool) => tool.name === "get_next_job"), "both preset roles work through its setup URL");
});

await test("the audit log tells the whole story", async () => {
  const r = await admin("GET", "/v1/events?limit=500");
  const kinds = new Set(r.data.events.map((e) => e.kind));
  for (const k of ["created", "claimed", "claim_resent", "submission_rejected", "completed", "lease_expired", "approved", "input_requested", "answered", "sent_back", "accepted", "canceled", "failed", "schedule_saved", "agent_added"]) {
    assert(kinds.has(k), `missing event kind ${k}`);
  }
  const ov = await admin("GET", "/v1/admin/overview");
  eq(ov.status, 200, "overview");
  assert(ov.data.agents.some((a) => a.id === grok.id && a.stats.completed_total >= 3), "agent stats");
});

// Leave the database as we found it: disconnecting this run's agents also cancels their open jobs.
for (const agentId of created) await admin("DELETE", `/v1/admin/agents/${agentId}`);

console.log(`\n${passed} passed, ${failures.length} failed (cleaned up ${created.length} test agents)`);
if (failures.length) process.exit(1);
