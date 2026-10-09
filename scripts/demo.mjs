#!/usr/bin/env node
// Seeds a local relay with sample agents and jobs so the dashboard has something to show.
// Everything goes through the public API, so it doubles as a walkthrough of a normal day.
//   RELAY_URL=http://127.0.0.1:8787 ADMIN_TOKEN=dev-admin-token node scripts/demo.mjs

const BASE = (process.env.RELAY_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const ADMIN = process.env.ADMIN_TOKEN || "dev-admin-token";

async function call(method, path, token, body, raw) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": raw ? "text/markdown" : "application/json",
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function agent(spec) {
  const out = await call("POST", "/v1/admin/agents", ADMIN, { ...spec, rotate_token: true });
  return { id: out.agent.id, token: out.token };
}
const post = (from, job) => call("POST", "/v1/jobs", from.token, job).then((r) => r.job);
const claim = (worker) => call("POST", "/v1/work/next", worker.token);
const submit = (claimed, text) =>
  fetch(claimed.submit_url, { method: "POST", headers: { "content-type": "text/markdown", accept: "application/json" }, body: text }).then((r) => r.json());

const claude = await agent({ id: "claude-code", name: "Claude Code", can_request: true });
const codex = await agent({ id: "codex", name: "Codex", can_request: true });
const grok = await agent({ id: "grok", name: "Grok Bot", can_work: true, work_types: ["research", "summarize", "monitor"], can_request: true, request_targets: ["runner"] });
const muse = await agent({ id: "muse", name: "Muse", can_work: true, work_types: ["research", "summarize", "digest"], poll_minutes: 15 });
const runner = await agent({ id: "runner", name: "Mac runner", can_work: true, work_types: ["build", "review"] });

// 1. Research that came back typed and sourced.
await post(claude, {
  type: "research",
  to: "grok",
  title: "Complaints about coding-agent usage limits, last 30 days",
  goal: "Collect public complaints about usage limits in Codex and Claude Code from the last 30 days and group them by theme.",
  constraints: ["Public posts only", "At most 20 sources"],
  acceptance: ["Every theme has at least two source URLs"],
  output: {
    format: "json",
    schema: {
      type: "object",
      required: ["themes"],
      properties: { themes: { type: "array", items: { type: "object", required: ["theme", "count"], properties: { theme: { type: "string" }, count: { type: "integer" } } } } },
    },
  },
});
let c = await claim(grok);
await submit(c, "## Summary\nThey're unhappy.");
await submit(
  c,
  [
    "## Summary",
    "Three themes: weekly caps landing mid-task, unclear accounting of what counts, and the restored 5-hour window on Plus.",
    "",
    "```json",
    JSON.stringify({ themes: [{ theme: "Weekly cap hit mid-task", count: 9 }, { theme: "Unclear accounting", count: 6 }, { theme: "5-hour window returned", count: 4 }] }, null, 2),
    "```",
    "",
    "## Sources",
    "- https://github.com/openai/codex/issues/28879",
    "- https://github.com/anthropics/claude-code/issues/38335",
  ].join("\n"),
);

// 2. A monitor that found nothing new.
await post(codex, { type: "monitor", to: "grok", title: "New mentions of the project on X and HN", goal: "Report new mentions since the last run." });
c = await claim(grok);
await submit(c, "## Summary\nNothing new since yesterday.");

// 3. A worker asked a question.
await post(claude, {
  type: "research",
  to: "muse",
  title: "How consumer agents handle scheduled outbound requests",
  goal: "Find how Muse, Grok Bot, and ChatGPT handle outbound HTTP requests from scheduled tasks, including approval prompts.",
});
c = await claim(muse);
await submit(c, "NEEDS_INPUT: Should I include community reports, or only official documentation?");

// 4. A build waiting on the owner.
await post(grok, {
  type: "build",
  to: "runner",
  title: "Fix the broken Contact link in the site footer",
  goal: "Someone on X reported that the footer Contact link returns a 404. Point it at /contact and open a pull request.",
  inputs: { repo: "github.com/you/personal-site", base: "main" },
  acceptance: ["A pull request is open; nothing is merged"],
});

// 5. Work in progress.
await post(codex, { type: "summarize", to: "muse", title: "What changed in the A2A 1.0 spec", goal: "Summarize the changes in A2A 1.0 that matter to someone building a relay between agents." });
await claim(muse);

// 6. Waiting in the queue for any worker.
await post(claude, { type: "research", to: "*", title: "Pricing pages of six agent orchestration tools", goal: "Collect current pricing for Conductor, Orca, Paperclip, Gas Town, Agent Relay, and Vibe Kanban." });

// 7. A clean failure.
await post(claude, { type: "summarize", to: "grok", title: "Summarize a paywalled analysis", goal: "Summarize the linked analysis." });
c = await claim(grok);
await submit(c, "FAILED: The page is behind a paywall I can't get past.");

// 8. A daily schedule.
await call("POST", "/v1/admin/schedules", ADMIN, {
  id: "daily-mentions",
  every_minutes: 1440,
  from: "codex",
  start_in_minutes: 600,
  template: { type: "monitor", to: "grok", title: "New mentions of the project on X and HN", goal: "Report new mentions since the last run." },
});

console.log(`Seeded sample data. Open ${BASE} and sign in with your owner token.`);
