/** Vercel preview builds have no API or sign-in, so their /app-next runs the real
 * workspace interface against this in-page sample workspace. web/build.mjs adds it
 * only to preview builds without API configuration; production builds never load it.
 * Nothing here reaches a server: requests to PREVIEW_API are answered in the page,
 * and the sample data lives in this browser's localStorage. */
import { PLATFORMS, pairingInstructions, platformById, setupGuide } from "../src/platforms";

export const PREVIEW_API = "https://preview.hitchhike.invalid";
const RELAY = "https://api.hitchhike.dev", KEY = "hitchhike-preview-workspace", CONNECTS_AFTER = 12_000;
const ALL = ["task", "research", "summarize", "monitor", "digest", "review", "build"];
// Assistants a person can connect from a phone appear to connect on their own;
// computer-only ones stay waiting, as they would until someone uses a computer.
const SELF_CONNECTING = new Set(["claude", "grok-bot", "muse", "grok", "openclaw", "other"]);
const SURFACE: Record<string, string> = { dot: "dots", "claude-code": "terminal", codex: "desktop", openclaw: "terminal", other: "terminal" };

interface Agent { id: string; name: string; platform: string; can_request: boolean; can_work: boolean; work_types: string[]; poll_minutes: number | null; created_at: string; last_seen_at: string | null; waiting_since?: number }
interface Entry { version: number; settings: Record<string, any>; onboarding: Record<string, unknown> }
interface Sample { agents: Agent[]; entries: Record<string, Entry> }

export function installPreviewWorkspace(): void {
  const empty = (): Sample => ({ agents: [], entries: {} });
  let sample: Sample;
  try { sample = JSON.parse(localStorage.getItem(KEY) || "null") ?? empty(); } catch { sample = empty(); }
  if (!Array.isArray(sample.agents) || !sample.entries) sample = empty();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(sample)); } catch {} };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const missing = () => json({ error: { code: "not_found", message: "Not in this preview." } }, 404);
  const find = (id: string) => sample.agents.find(agent => agent.id === id);
  const view = (a: Agent) => {
    const p = platformById(a.platform);
    return { id: a.id, handle: a.id, name: a.name, can_request: a.can_request, can_work: a.can_work, work_types: a.work_types, request_targets: ["*"], accept_from: ["*"],
      platform: p.id, platform_label: p.label, connects: p.connects, poll_minutes: a.poll_minutes, can_show_setup: true, created_at: a.created_at, last_seen_at: a.last_seen_at,
      stats: { sent_24h: 0, claimed_24h: 0, completed_total: 0, working: 0 } };
  };
  const entry = (a: Agent) => sample.entries[a.id] ??= { version: 0, onboarding: { provider: a.platform, surface: SURFACE[a.platform] ?? "chat", step: "choose", updated_at: null },
    settings: { purpose: "", permitted_collaborators: ["*"], allowed_request_categories: [...ALL], allowed_work_categories: [...a.work_types], sharing: { instructions: "", approved_sources: [], recipient_rules: [] },
      standing_responsibilities: [], initiative: false, authorization_boundaries: [], background: { method: "manual", interval_minutes: null }, instructions: { profile: "judgment", custom_prompt: null }, setup_background: null } };
  const configuration = (a: Agent) => {
    const e = entry(a);
    return { agent_id: a.id, version: e.version, updated_at: null, settings: e.settings, onboarding: e.onboarding, release: { enabled: true, configured: true, source: "workspace" },
      roster: a.can_request ? sample.agents.filter(o => o.id !== a.id && o.can_work).map(o => ({ id: o.id, name: o.name, provider: o.platform, purpose: entry(o).settings.purpose, work_categories: ALL, last_seen_at: o.last_seen_at })) : [],
      readiness: { access: { verified: !!a.last_seen_at, last_seen_at: a.last_seen_at }, collaboration: { verified: false }, peer_collaboration: { verified: false }, background: { verified: false, observed_runs: 0 } } };
  };
  // Mirrors backgroundSelectionForConfiguration: a saved choice, else an established setting, else defaults.
  const guideInput = (a: Agent, pairingCode?: string) => {
    const e = entry(a), saved = e.settings.setup_background;
    const background = saved ? { enabled: saved.enabled, intervalMinutes: saved.interval_minutes } : e.version > 0 ? { enabled: e.settings.background.method === "scheduled", intervalMinutes: e.settings.background.interval_minutes } : undefined;
    return { agentId: a.id, name: a.name, token: "", relayUrl: RELAY, canWork: a.can_work, canRequest: a.can_request, workTypes: a.work_types, pollMinutes: a.poll_minutes,
      platform: a.platform, hosted: true, surface: String(e.onboarding.surface), conversationTools: true, background, pairingCode };
  };
  const code = () => "pair_" + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"[byte % 55]).join("");

  function answer(method: string, path: string, body: any): Response {
    const now = Date.now();
    for (const a of sample.agents) if (!a.last_seen_at && a.waiting_since && SELF_CONNECTING.has(a.platform) && now - a.waiting_since > CONNECTS_AFTER) a.last_seen_at = new Date(now).toISOString();
    let m: RegExpMatchArray | null;
    if (path === "/auth/session") return json({ authenticated: true, user: { id: "preview", email: "you@preview.hitchhike", name: "You" }, workspace: { id: "ws_preview", name: "Preview" }, csrfToken: "preview" });
    if (path === "/auth/logout") { sample = empty(); return json({ ok: true }); }
    if (path === "/v1/workspace/release") return json({ enabled: true, configured: true, source: "workspace" });
    if (path === "/v1/admin/overview") return json({ relay: { name: "Hitchhike", url: RELAY, protocol: "1", now: new Date(now).toISOString() }, job_types: [], platforms: PLATFORMS, agents: sample.agents.map(view), jobs: [], schedules: [], events: [], release: { enabled: true } });
    if (path === "/v1/admin/agents" && method === "GET") return json({ agents: sample.agents.map(view) });
    if (path === "/v1/admin/agents" && method === "POST") {
      const known = find(body.id);
      if (known) {
        for (const key of ["name", "can_request", "can_work", "work_types"] as const) if (key in body) (known as any)[key] = body[key];
        if (body.rotate_token) { known.last_seen_at = null; delete known.waiting_since; }
        return json({ agent: view(known), created: false });
      }
      if (sample.agents.length >= 10) return json({ error: { code: "connection_limit", message: "This preview holds up to 10 assistants." } }, 409);
      const a: Agent = { id: body.id, name: body.name, platform: body.platform, can_request: body.can_request !== false, can_work: body.can_work !== false,
        work_types: Array.isArray(body.work_types) ? body.work_types : [...ALL], poll_minutes: body.poll_minutes ?? null, created_at: new Date(now).toISOString(), last_seen_at: null };
      sample.agents.push(a);
      return json({ agent: view(a), created: true }, 201);
    }
    if ((m = path.match(/^\/v1\/admin\/agents\/([^/]+)$/)) && method === "DELETE") {
      sample.agents = sample.agents.filter(a => a.id !== m![1]); delete sample.entries[m[1]];
      return json({ ok: true });
    }
    if ((m = path.match(/^\/v1\/admin\/agents\/([^/]+)\/(setup|pairing)$/))) {
      const a = find(m[1]);
      if (!a) return missing();
      a.waiting_since ??= now;
      if (m[2] === "setup") return json({ guide: setupGuide(guideInput(a)) });
      const pairingCode = code();
      return json({ code: pairingCode, expires_at: new Date(now + 600_000).toISOString(), instructions: pairingInstructions(guideInput(a, pairingCode)) });
    }
    if ((m = path.match(/^\/v1\/agents\/([^/]+)\/(collaboration|onboarding|activation)$/))) {
      const a = find(m[1]);
      if (!a) return missing();
      if (m[2] === "activation") return json({ activation: null });
      const e = entry(a);
      if (m[2] === "onboarding") { e.onboarding = { ...e.onboarding, ...body, updated_at: new Date(now).toISOString() }; return json(configuration(a)); }
      if (method === "PUT") {
        if (body.expected_version !== undefined && body.expected_version !== e.version) return json({ error: { code: "configuration_changed", message: "These settings changed elsewhere. Refresh before saving." } }, 409);
        const { expected_version: _version, ...patch } = body;
        e.settings = { ...e.settings, ...patch }; e.version++;
      }
      return json(configuration(a));
    }
    if (path === "/v1/conversations") return json({ conversations: [] });
    if (path === "/v1/admin/workspace") return json(method === "GET" ? { workspace: { paused: false, retention_days: 30 }, usage: { connections: sample.agents.length, jobs_month: 0, jobs_day: 0, open_jobs: 0, storage_bytes: 0 }, limits: { connections: 10, jobs_month: 1000, jobs_day: 100, open_jobs: 50, storage_bytes: 52_428_800 } } : { ok: true });
    return missing();
  }

  const network = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== PREVIEW_API) return network(input, init);
    await new Promise(resolve => setTimeout(resolve, 180));
    const response = answer((init?.method || "GET").toUpperCase(), url.pathname, init?.body ? JSON.parse(String(init.body)) : {});
    save();
    return response;
  };
  document.addEventListener("DOMContentLoaded", () => {
    const reset = document.createElement("button");
    reset.type = "button"; reset.textContent = "Start over";
    reset.setAttribute("style", "margin-left:10px;padding:0;border:0;background:none;color:#FFB45E;font:600 12px/1 Inter,system-ui,sans-serif;text-decoration:underline;cursor:pointer");
    reset.addEventListener("click", () => { try { localStorage.removeItem(KEY); sessionStorage.clear(); } catch {} location.replace(location.pathname); });
    const note = document.createElement("div");
    note.setAttribute("role", "note");
    note.setAttribute("style", "display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:2px;min-height:34px;padding:6px 16px;padding-top:max(6px,env(safe-area-inset-top));background:#0D0F11;color:rgba(255,255,255,.82);font:500 12px/1.4 Inter,system-ui,sans-serif;text-align:center");
    note.append("Preview with sample data. Connections are simulated.", reset);
    document.body.prepend(note);
    // The preview is always signed in; after "Sign out", reopen the sample instead of real sign-in.
    document.getElementById("gate-sign-in")?.setAttribute("href", location.pathname);
  });
}
