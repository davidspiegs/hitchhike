/** Browser runtime emitted through the existing hashed-inline-script CSP build.
 * Keep untrusted data in text nodes and secrets out of persisted drafts.
 */
export const WORKSPACE_JS = String.raw`
(() => {
  (() => {
    "use strict";
    const $ = (selector, root) => (root || document).querySelector(selector);
    const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
    const HOSTED = document.body.dataset.hosted === "true";
    const CLERK = HOSTED && document.body.dataset.authProvider === "clerk";
    const API = document.body.dataset.apiUrl || "";
    const ASSETS = JSON.parse(document.body.dataset.assets || "{}");
    const KEY = "relay_owner_token";
    const main = $("#main");
    const memory = { get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    }, set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
      }
    }, del(k) {
      try {
        localStorage.removeItem(k);
      } catch {
      }
    } };
    // Per-tab timestamps only (never codes): when this tab last issued a pairing code.
    const tabMemory = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch {} } };
    let token = HOSTED ? null : memory.get(KEY), csrf = null, session = null, overview = null, configs = /* @__PURE__ */ new Map(), guides = /* @__PURE__ */ new Map(), pairing = /* @__PURE__ */ new Map();
    const contextDrafts = new Map();
    let heldDrafts = null;
    const configFetchedAt = new Map();
    const configRequests = new Map();
    const POLL_DELAYS = [15e3, 30e3, 60e3, 120e3, 300e3, 900e3];
    const POLL_WINDOW = 86400e3, POLL_ROUNDS = 100, CONFIG_MAX_AGE = 300e3;
    let pollScope = null, pollStep = 0, pollRounds = [], nextPollAt = 0, readPauseUntil = 0, lastUpdatedAt = 0, lastRefreshAt = 0, focusTimer = null;
    function resetPolling() {
      clearTimeout(timer); clearTimeout(focusTimer);
      pollScope = null; pollStep = 0; pollRounds = []; nextPollAt = 0; readPauseUntil = 0; lastUpdatedAt = 0; lastRefreshAt = 0;
    }
    function syncPollScope() {
      const identity = draftIdentity() || "session:" + epoch;
      if (pollScope !== identity) { resetPolling(); pollScope = identity; }
    }
    function pausedReadError() {
      return Object.assign(new Error("Workspace status reads are paused until " + date(readPauseUntil) + "."), { code: "read_pause", status: 429, retryAt: readPauseUntil });
    }
    function automaticDeadline() {
      const now = Date.now();
      pollRounds = pollRounds.filter(at => at > now - POLL_WINDOW);
      return Math.max(nextPollAt || now + POLL_DELAYS[0], readPauseUntil, pollRounds.length >= POLL_ROUNDS ? pollRounds[0] + POLL_WINDOW : 0);
    }
    let epoch = 0, routeEpoch = 0, timer = null, signedIn = false, loading = null, refreshing = false, toastTimer = null, dirty = false, moreOpen = false;
    const OPEN = /* @__PURE__ */ new Set(["queued", "claimed", "input_required", "needs_approval"]);
    const TYPE_LABELS = { task: "General tasks", research: "Research", summarize: "Summaries", monitor: "Monitoring", digest: "Digests", review: "Reviews", build: "Building and changes" };
    const statusNames = { queued: "Waiting for pickup", claimed: "Picked up", input_required: "Needs clarification", needs_approval: "Needs your approval", completed: "Reply ready", failed: "Failed", canceled: "Stopped", expired: "Expired" };
    // One choice per account: apps that share a sign-in share one connection.
    const LABELS = { claude: "Claude", "grok-bot": "Grok Bot", muse: "Muse", chatgpt: "ChatGPT", dot: "Dots", "claude-code": "Claude Code", codex: "Codex", grok: "Grok", openclaw: "OpenClaw", other: "Another agent" };
    const CHOICES = [
      ["claude", "phone", "Also covers Claude Duet"], ["grok-bot", "phone", "Send it one message"], ["muse", "phone", "Send it one message"],
      ["chatgpt", "computer", "Also covers Dots and Codex"], ["claude-code", "computer", "Runs on your computer"],
      ["grok", "more", "The chat app, separate from Grok Bot"], ["openclaw", "more", "Checks in on its own heartbeat"], ["other", "more", "Anything that can call a web API"],
    ];
    const DESK_ORDER = ["claude", "chatgpt", "claude-code", "grok-bot", "muse"];
    // [file, image size in a 40px tile]; 0 means the artwork is its own full-bleed tile.
    const ART = { claude: ["claude.svg", 26], "grok-bot": ["grok-bot.svg", 28], muse: ["muse.svg", 28], chatgpt: ["chatgpt.svg", 24], dot: ["chatgpt.svg", 24], "claude-code": ["claude-code.png", 28], codex: ["codex.png", 0], grok: ["grok.png", 0], openclaw: ["openclaw.svg", 26] };
    const COMPUTER = new Set(["chatgpt", "dot", "claude-code", "codex"]);
    const OPENAI = new Set(["chatgpt", "dot"]);
    const CODE = new Set(["claude-code", "codex"]);
    const GOOD_AT = { claude: "Writing, research and planning", chatgpt: "Research, analysis and everyday questions", dot: "Research, analysis and everyday questions", "claude-code": "Code changes in your projects", codex: "Code changes and reviews", "grok-bot": "Quick research and keeping an eye on things", grok: "Quick research and current events", muse: "Everyday questions and ideas", openclaw: "Tasks on your own computer" };
    const SCHEDULED = { muse: 10, "grok-bot": 10 };
    // Today's requested-schedule defaults (defaultBackgroundSelection). Saved with the
    // first settings write, because any saved version otherwise reads as "off".
    const SCHEDULE_DEFAULT = { claude: 60, grok: 60, chatgpt: 60, ...SCHEDULED };
    const INTERVALS = [5, 10, 15, 30, 60];
    function el(tag, attrs, ...kids) {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs || {})) {
        if (value === null || value === void 0 || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "value") node.value = value;
        else if (key === "checked") node.checked = !!value;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? "" : String(value));
      }
      for (const child of kids.flat(Infinity)) if (child !== null && child !== void 0 && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
      return node;
    }
    const ICONS = {
      chev: ["m8 5 5 5-5 5"], down: ["m5 8 5 5 5-5"], back: ["m12 4.5-5.5 5.5 5.5 5.5"], plus: ["M10 4.5v11M4.5 10h11"], check: ["m4.5 10.5 3.5 3.5 7.5-8"],
      copy: [["rect", 7, 7, 10, 10, 2.2], "M13 7V5.2A2.2 2.2 0 0 0 10.8 3H5.2A2.2 2.2 0 0 0 3 5.2v5.6A2.2 2.2 0 0 0 5.2 13H7"],
      share: ["M10 12.5V3.2M6.6 6.4 10 3l3.4 3.4", "M6.5 9H5.4A1.9 1.9 0 0 0 3.5 10.9v4.2A1.9 1.9 0 0 0 5.4 17h9.2a1.9 1.9 0 0 0 1.9-1.9v-4.2A1.9 1.9 0 0 0 14.6 9h-1.1"],
      lock: [["rect", 4.5, 9, 11, 8, 2], "M7 9V6.8a3 3 0 0 1 6 0V9"], clock: [["circle", 10, 10, 7.2], "M10 6.2V10l2.6 1.6"],
      phone: [["rect", 5.5, 2, 9, 16, 2.5], "M8.75 15h2.5"], computer: [["rect", 3.5, 4, 13, 9, 1.6], "M1.75 16h16.5"],
      info: [["circle", 10, 10, 7.2], "M10 9.2v4.3M10 6.5v.1"], pencil: ["M4.5 15.5h2.7l7.6-7.6a1.9 1.9 0 0 0-2.7-2.7l-7.6 7.6z", "m11.2 6.1 2.7 2.7"], alert: ["M10 3.5 2.8 16h14.4z", "M10 8.5v3.2M10 13.9v.1"], person: [["circle", 10, 7, 3.2], "M3.8 16.5a6.2 6.2 0 0 1 12.4 0"],
    };
    function svg(name, cls) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      node.setAttribute("viewBox", "0 0 20 20");
      node.setAttribute("class", "i" + (cls ? " " + cls : ""));
      node.setAttribute("aria-hidden", "true");
      for (const part of ICONS[name] || []) {
        const shape = document.createElementNS(node.namespaceURI, typeof part === "string" ? "path" : part[0]);
        if (typeof part === "string") shape.setAttribute("d", part);
        else if (part[0] === "rect") ["x", "y", "width", "height", "rx"].forEach((key, i) => shape.setAttribute(key, String(part[i + 1])));
        else ["cx", "cy", "r"].forEach((key, i) => shape.setAttribute(key, String(part[i + 1])));
        node.append(shape);
      }
      return node;
    }
    function setClass(node, name, on) {
      const list = String(node.className || "").split(" ").filter(item => item && item !== name);
      if (on) list.push(name);
      node.className = list.join(" ");
    }
    function platformOf(id) { return overview?.platforms?.find(p => p.id === id) || null; }
    function labelOf(id) { return LABELS[id] || platformOf(id)?.label || "Assistant"; }
    function routine(a) { return (a?.connects || platformOf(a?.platform)?.connects) === "routine"; }
    function isPhone() {
      try { return !!window.matchMedia?.("(max-width: 899px), (pointer: coarse)")?.matches; } catch { return false; }
    }
    function tile(platform, size = "", name = "") {
      const art = ART[platform], asset = art && ASSETS["assets/agents/" + art[0]];
      const node = el("span", { class: (size === "mini" ? "mini" : "tile" + (size ? " " + size : "")) + (asset && !art[1] ? " full" : ""), "aria-hidden": "true" });
      if (asset) {
        const image = el("img", { src: asset, alt: "" });
        if (art[1]) image.style.width = image.style.height = Math.round(art[1] * ({ lg: 1.3, xl: 1.84, mini: 0.66 }[size] || 1)) + "px";
        node.append(image);
      } else node.append(el("span", { class: "glyph" }, (name || labelOf(platform)).trim().charAt(0).toUpperCase() || "?"));
      return node;
    }
    function busTile(size = "lg") {
      const logo = ASSETS["assets/hitchhike-bus-logo.png"];
      return el("span", { class: "tile " + size, "aria-hidden": "true" }, logo ? el("span", { class: "bus" }, el("img", { class: "art", src: logo, alt: "" })) : el("span", { class: "glyph" }, "H"));
    }
    function route2(left, right, done) {
      return el("div", { class: "link" + (done ? " done" : ""), id: "setup-link", "aria-hidden": "true" }, left, el("span", { class: "track" }), right);
    }
    function rich(parts) {
      return parts.map(part => Array.isArray(part) ? el("b", {}, part[0]) : part);
    }
    function btn(label, action, quiet = false, attrs = {}) {
      return el(typeof action === "string" ? "a" : "button", Object.assign({ class: "btn" + (quiet ? " quiet" : ""), ...typeof action === "string" ? { href: action } : { type: "button", onclick: action } }, attrs), label);
    }
    function head(title, description, action) {
      return el("header", { class: "page-head" }, el("div", {}, el("h1", {}, title), description && el("p", {}, description)), action && el("div", { class: "head-action" }, action));
    }
    function back(href = "#/agents", text = "Your assistants") {
      return el("a", { class: "back", href }, svg("back"), text);
    }
    function flowTop(href = "#/agents", label = "Your assistants") {
      return [el("div", { class: "flowtop" }, el("a", { class: "ib", href, "aria-label": label }, svg("back"))), el("a", { class: "back deskback", href }, svg("back"), label)];
    }
    function foot(text) {
      return el("p", { class: "footnote" }, svg("info"), text);
    }
    function note(title, text, action, tone = "") {
      return el("section", { class: "notice " + tone }, svg(tone === "error" ? "alert" : "info"), el("div", {}, el("h2", {}, title), el("p", {}, text)), action);
    }
    function state(text, tone = "") {
      return el("span", { class: "status " + tone }, text);
    }
    function errorBox() {
      return el("p", { class: "error-text", role: "alert", hidden: true });
    }
    function showError(box, error) {
      box.hidden = false;
      box.textContent = error.message || String(error);
    }
    function ago(value) {
      if (!value) return "Not yet";
      const seconds = Math.max(0, (Date.now() - Date.parse(value)) / 1e3);
      return seconds < 60 ? "just now" : seconds < 5400 ? Math.round(seconds / 60) + " min ago" : seconds < 129600 ? Math.round(seconds / 3600) + " h ago" : new Date(value).toLocaleDateString(void 0, { month: "short", day: "numeric" });
    }
    function every(minutes) {
      return minutes === 60 ? "hour" : minutes % 60 === 0 ? minutes / 60 + " hours" : minutes + " minutes";
    }
    function who(id) {
      return id === "owner" ? "You" : overview?.agents.find((a) => a.id === id)?.name || id || "Assistant";
    }
    function date(value) {
      return value ? new Date(value).toLocaleString(void 0, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not yet";
    }
    function toast(text) {
      clearTimeout(toastTimer);
      $("#toast").textContent = text;
      $("#toast").hidden = false;
      toastTimer = setTimeout(() => $("#toast").hidden = true, 6e3);
    }
    async function copyText(text, button, fallback, done = "Copied") {
      const label = $("span", button), before = label?.textContent;
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
          const area = el("textarea", { value: text, style: "position:fixed;left:0;top:0;opacity:0" });
          document.body.append(area);
          area.select();
          const ok = document.execCommand("copy");
          area.remove();
          if (!ok) throw new Error("clipboard");
        }
        // Icon-only buttons keep their icon; the toast confirms instead.
        if (label) label.textContent = done; else toast(done + ".");
        setTimeout(() => {
          if (label && button.isConnected) label.textContent = before;
        }, 2e3);
        return true;
      } catch {
        if (fallback) {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(fallback);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        toast("Copy isn’t available here. The text is selected, so use your device’s Copy action.");
        return false;
      }
    }
    async function shareText(payload, button, fallback, copyValue) {
      if (navigator.share) {
        try { await navigator.share(payload); return; } catch (e) { if (e?.name === "AbortError") return; }
      }
      await copyText(copyValue, button, fallback);
    }
    function copybox(label, text) {
      const content = el("pre", { tabindex: "0" }, text), button = el("button", { type: "button", class: "btn sm" }, svg("copy"), el("span", {}, "Copy"));
      button.addEventListener("click", () => copyText(text, button, content));
      return el("div", { class: "copybox" }, el("div", { class: "copytop" }, el("strong", {}, label), button), content);
    }
    async function api(path, options = {}) {
      const generation = epoch;
      syncPollScope();
      const requestScope = pollScope, ownerRead = (!options.method || options.method === "GET") && path.startsWith("/v1/");
      if (ownerRead && readPauseUntil > Date.now()) throw pausedReadError();
      const headers = { accept: "application/json", "content-type": "application/json" };
      if (HOSTED) {
        if (csrf) headers["X-CSRF-Token"] = csrf;
        if (CLERK) {
          const bearer = await window.AgentConnectAuth?.getToken();
          if (!bearer) { if (generation === epoch) expireSession(); throw Object.assign(new Error("Your session expired. Sign in to continue."), { code: "auth" }); }
          headers.authorization = "Bearer " + bearer;
        }
      } else if (token) headers.authorization = "Bearer " + token;
      if (options.key) headers["Idempotency-Key"] = options.key;
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 2e4);
      let response;
      try {
        response = await fetch(API + path, { method: options.method || "GET", credentials: API ? "omit" : "same-origin", headers, body: options.body !== void 0 ? JSON.stringify(options.body) : void 0, signal: controller.signal });
      } catch (e) {
        throw new Error(e.name === "AbortError" ? "The request took too long. Your last saved progress is safe. Try again." : "Could not reach Hitchhike. Check your connection and try again.");
      } finally {
        clearTimeout(timeout);
      }
      let body = {};
      try {
        body = await response.json();
      } catch {
      }
      if (!response.ok) {
        const error = Object.assign(new Error(body.error?.message || "Hitchhike returned " + response.status + ". Try again."), { code: body.error?.code, status: response.status });
        if (response.status === 429 && ownerRead && generation === epoch && requestScope === (draftIdentity() || "session:" + epoch)) {
          const retry = response.headers?.get("Retry-After"), seconds = retry && /^\d+(?:\.\d+)?$/.test(retry.trim()) ? Number(retry) : NaN;
          const deadline = Number.isFinite(seconds) ? Date.now() + seconds * 1e3 : Date.parse(retry || "");
          readPauseUntil = Math.max(readPauseUntil, Number.isFinite(deadline) && deadline > Date.now() ? deadline : Date.now() + POLL_DELAYS[POLL_DELAYS.length - 1]);
          error.retryAt = readPauseUntil;
          schedule();
        }
        if (response.status === 401) {
          error.code = "auth";
          if (generation === epoch) expireSession();
        }
        throw error;
      }
      return body;
    }
    async function fetchOverview() {
      if (loading) return loading;
      const generation = epoch;
      const request = (async () => {
        const result = await api("/v1/admin/overview");
        if (generation !== epoch) return;
        overview = result;
        syncPollScope();
        const r = parseRoute(), target = result.agents.find(a => a.id === r.id && ["setup", "agents"].includes(r.page));
        const outdated = a => !configs.has(a.id) || Date.now() - (configFetchedAt.get(a.id) || 0) >= CONFIG_MAX_AGE;
        // Home's first-handoff card reads the sender's roster, so fetch that one first.
        const sender = !target && r.page === "agents" && !r.id && result.agents.filter(a => a.last_seen_at).length > 1 ? handoffSenders(result.agents).find(outdated) : null;
        const stale = target || sender || result.agents.filter(a => !configs.has(a.id) || Date.now() - (configFetchedAt.get(a.id) || 0) >= CONFIG_MAX_AGE).sort((a, b) => (configFetchedAt.get(a.id) || 0) - (configFetchedAt.get(b.id) || 0))[0];
        if (stale) {
          try { await configuration(stale.id, r.page === "setup"); }
          catch (e) { if (e.code === "auth" || e.status === 429) throw e; }
        }
        if (generation !== epoch) return;
        lastUpdatedAt = Date.now();
        $("#network-error").hidden = true;
      })();
      loading = request;
      try { await request; } finally { if (loading === request) loading = null; }
    }
    function network(error) {
      if (error.code === "auth") return;
      $("#network-error").hidden = false;
      $("#network-error").textContent = error.retryAt ? "Status updates are paused until " + date(error.retryAt) + ". Your saved progress is safe." : error.message + " Your saved progress is safe, and Hitchhike will try again on its own.";
    }
    function draftIdentity() {
      if (HOSTED) return session?.user?.id && session?.workspace?.id ? JSON.stringify([session.user.id, session.workspace.id]) : null;
      return token ? JSON.stringify([token, overview?.workspace?.id || "selfhost"]) : null;
    }
    function expireSession() {
      const identity = draftIdentity();
      if (identity && contextDrafts.size) heldDrafts = { identity, contexts: new Map(contextDrafts) };
      signOut("Your session expired. Sign in to continue.", true);
      if (heldDrafts) {
        const signIn = $("a.btn", $("#gate"));
        if (signIn) { signIn.setAttribute("target", "_blank"); signIn.setAttribute("rel", "noopener noreferrer"); }
        $("#gate").append(el("div", { id: "draft-reauth" }, el("p", { class: "small muted" }, HOSTED ? "Your unsaved text is kept in this tab. Keep it open, sign in in the new tab, then return here. Drafts return only for the same account and workspace." : "Your unsaved text is kept in this tab. Reopen the same workspace with the same owner key to restore it."), HOSTED ? btn("Resume after signing in", boot, true) : null, btn("Discard saved drafts", () => signOut("Sign in to continue."), true)));
      }
    }
    function signOut(message = "", preserveDrafts = false) {
      if (!preserveDrafts) heldDrafts = null;
      $("#draft-reauth")?.remove();
      const signIn = $("a.btn", $("#gate"));
      if (signIn) { signIn.removeAttribute("target"); signIn.removeAttribute("rel"); }
      epoch++;
      routeEpoch++;
      signedIn = false;
      stopWatch();
      resetPolling();
      loading = null;
      refreshing = false;
      token = null;
      csrf = null;
      session = null;
      overview = null;
      configs.clear();
      configFetchedAt.clear();
      configRequests.clear();
      guides.clear();
      pairing.clear();
      contextDrafts.clear();
      memory.del(KEY);
      dirty = false;
      main.replaceChildren();
      $("#side-agents")?.replaceChildren();
      $("#boot").replaceChildren();
      if ($("#owner-key")) $("#owner-key").value = "";
      $("#workspace").hidden = true;
      $("#boot").hidden = true;
      $("#gate").hidden = false;
      $("#session-error").hidden = !message;
      $("#session-error").textContent = message;
    }
    async function refresh() {
      if (refreshing || !signedIn || document.hidden) return;
      syncPollScope();
      const now = Date.now(), generation = epoch;
      pollRounds = pollRounds.filter(at => at > now - POLL_WINDOW);
      if (readPauseUntil > now || pollRounds.length >= POLL_ROUNDS) { schedule(); return; }
      pollRounds.push(now);
      lastRefreshAt = now;
      clearTimeout(timer);
      clearTimeout(focusTimer);
      refreshing = true;
      try {
        await fetchOverview();
        if (generation !== epoch) return;
        const r = parseRoute();
        renderSideAgents(r);
        if (r.page === "activity" || (r.page === "agents" && !r.id)) await render(false);
        else if (r.page === "setup") updateSetupStatus(r.id);
      } catch (e) {
        if (generation === epoch) network(e);
      } finally {
        if (generation === epoch) {
          refreshing = false;
          pollStep = Math.min(pollStep + 1, POLL_DELAYS.length - 1);
          nextPollAt = Date.now() + POLL_DELAYS[pollStep];
          schedule();
        }
      }
    }
    function schedule() {
      clearTimeout(timer);
      if (!signedIn) return;
      if (!nextPollAt) nextPollAt = Date.now() + POLL_DELAYS[pollStep];
      if (!document.hidden && !refreshing) timer = setTimeout(() => refresh(), Math.max(1, automaticDeadline() - Date.now()));
    }
    function foregroundRefresh() {
      clearTimeout(focusTimer);
      if (!signedIn || document.hidden) { clearTimeout(timer); return; }
      if (watch?.paused) resumeWatch();
      if (Date.now() - lastRefreshAt < 60e3) nextPollAt = Math.max(nextPollAt, lastRefreshAt + 60e3);
      if (readPauseUntil > Date.now() || Date.now() - lastRefreshAt < 60e3) { schedule(); return; }
      focusTimer = setTimeout(() => refresh(), 200);
    }
    document.addEventListener("visibilitychange", foregroundRefresh);
    window.addEventListener("focus", foregroundRefresh);
    function parseRoute() {
      const raw = location.hash.startsWith("#/") ? location.hash.slice(2) : "agents";
      const parts = raw.split("/").map((x) => {
        try {
          return decodeURIComponent(x);
        } catch {
          return "";
        }
      });
      return { page: parts[0] || "agents", id: parts[1], step: parts[2] || "connect" };
    }
    function route(href, replace = false) {
      if (replace) {
        history.replaceState(null, "", href);
        render();
      } else if (location.hash === href) render();
      else location.hash = href;
    }
    function skeleton() {
      return el("div", { role: "status", "aria-label": "Loading page" }, el("div", { class: "skeleton loading-title" }), [1, 2, 3].map(() => el("div", { class: "skeleton-row" }, el("div", { class: "skeleton" }), el("div", { class: "skeleton short" }))));
    }
    function agentHref(a) { return (a.last_seen_at ? "#/agents/" : "#/setup/") + encodeURIComponent(a.id); }
    function renderSideAgents(r = parseRoute()) {
      const slot = $("#side-agents");
      if (!slot) return;
      const agents = overview?.agents || [];
      slot.replaceChildren(...(agents.length ? [el("p", { class: "slabel" }, "Assistants"), ...agents.map(a => el("a", { class: "sitem", href: agentHref(a), "aria-current": r.id === a.id && ["agents", "setup"].includes(r.page) ? "page" : null },
        tile(a.platform, "mini", a.name), el("span", {}, a.name), el("span", { class: a.last_seen_at ? "ok" : "wait", role: "img", "aria-label": a.last_seen_at ? "Connected" : "Not connected yet" }))),
        el("a", { class: "sitem", href: "#/add", "aria-current": r.page === "add" ? "page" : null }, el("span", { class: "mini add" }, svg("plus")), el("span", {}, "Add an assistant"))] : []));
    }
    function renderAccount() {
      const email = HOSTED && typeof session?.user?.email === "string" ? session.user.email : "";
      const initial = email.trim().charAt(0).toUpperCase();
      for (const node of [$("#account-avatar"), $("#account-button")]) if (node) node.replaceChildren(initial || svg("person"));
      const label = $("#account-label");
      if (label) label.textContent = email || (HOSTED ? "Your workspace" : "Self-hosted workspace");
    }
    async function render(focus = true) {
      if (!signedIn || !overview) return;
      const generation = ++routeEpoch;
      const r = parseRoute();
      dirty = contextDrafts.size > 0;
      stopWatch();
      const section = ["activity", "conversations", "jobs"].includes(r.page) ? "activity" : r.page === "settings" ? "settings" : "agents";
      $$("[data-nav]").forEach(link => link.setAttribute("aria-current", link.dataset.nav === section ? "page" : "false"));
      const flow = ["setup", "add", "connect"].includes(r.page);
      setClass(document.body, "flow", flow);
      setClass(document.body, "tabbed", !flow && overview.agents.length > 0);
      renderSideAgents(r);
      if (focus) main.replaceChildren(skeleton());
      try {
        let content;
        if (r.page === "connect") content = await connectIntent(r.id);
        else if (r.page === "add") content = chooserPage(true);
        else if (r.page === "setup") content = await setupPage(r.id);
        else if (r.page === "agents" && r.id) content = await assistantPage(r.id);
        else if (r.page === "activity") content = await activityPage();
        else if (r.page === "conversations") content = await conversationPage(r.id);
        else if (r.page === "jobs") content = await legacyJobPage(r.id);
        else if (r.page === "settings") content = await settingsPage();
        else content = homePage();
        if (generation !== routeEpoch || content === null) return;
        main.replaceChildren(...[content].flat().filter((node) => node !== null && node !== undefined && node !== false));
        setClass(main, "enter", false);
        if (focus) {
          void main.offsetWidth;
          setClass(main, "enter", true);
          window.scrollTo(0, 0);
          main.focus({ preventScroll: true });
        }
        document.title = (main.querySelector("h1")?.textContent || "Your assistants") + " · Hitchhike";
        if (r.page === "setup") watchConnection(r.id);
      } catch (e) {
        if (generation !== routeEpoch || e.code === "auth") return;
        if (e.status === 429) network(e);
        main.replaceChildren(el("div", { class: "narrow" }, back(), el("h1", { class: "h1" }, "This page couldn’t load"), el("p", { class: "lead" }, "Your saved progress is still here."), note("Try again", e.message, btn("Reload page", () => render()), "error")));
      }
      schedule();
    }
    window.addEventListener("hashchange", () => render());
    try { window.matchMedia?.("(max-width: 899px), (pointer: coarse)")?.addEventListener?.("change", () => { const page = parseRoute().page; if (signedIn && ["agents", "add", "setup"].includes(page)) render(false); }); } catch {}
    window.addEventListener("beforeunload", (e) => {
      if (dirty || heldDrafts) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    function existingFor(platformId) {
      return overview.agents.find(a => a.platform === platformId || (OPENAI.has(platformId) && OPENAI.has(a.platform)));
    }
    function chooserPage(adding) {
      const row = ([id, , blurb]) => {
        const a = existingFor(id);
        const detail = a ? el("span", { class: "st" + (a.last_seen_at ? "" : " warn") }, el("span", { class: a.last_seen_at ? "ok" : "wait" }), a.last_seen_at ? "Connected" : COMPUTER.has(a.platform) ? "Finish on your computer" : "Not connected yet") : el("span", {}, blurb);
        return el("a", { class: "row", href: "#/connect/" + encodeURIComponent(id), "data-platform": id, onclick: arm(id) }, tile(id), el("span", { class: "rt" }, el("b", {}, labelOf(id)), detail), svg("chev", "chev"));
      };
      const pick = group => CHOICES.filter(choice => choice[1] === group);
      const moreList = el("div", { class: "group", id: "more-assistants", hidden: !moreOpen }, pick("more").map(row));
      const more = el("button", { type: "button", class: "more", "aria-expanded": moreOpen ? "true" : "false", "aria-controls": "more-assistants" }, el("span", { class: "rt" }, el("b", {}, "More assistants"), el("span", {}, "Grok chat, OpenClaw, another agent")), svg("down", "chev"));
      more.addEventListener("click", () => { moreOpen = !moreOpen; more.setAttribute("aria-expanded", String(moreOpen)); moreList.hidden = !moreOpen; });
      const lists = isPhone()
        ? [el("h2", { class: "label" }, svg("phone"), "Works from this phone"), el("div", { class: "group" }, pick("phone").map(row)), el("h2", { class: "label second" }, svg("computer"), "Add once from a computer"), el("div", { class: "group" }, pick("computer").map(row))]
        : [el("div", { class: "group desk-list" }, DESK_ORDER.map(id => row(CHOICES.find(choice => choice[0] === id))))];
      return el("div", { class: "chooser narrow" }, adding ? flowTop("#/agents", "Your assistants") : null,
        el("h1", { class: "h1" }, adding ? "Add an assistant" : "Which assistant do you use?"),
        el("p", { class: "lead" }, adding ? "It joins the assistants you’ve already connected." : "Pick one to start. You can add the others after."),
        lists, more, moreList);
    }
    function uniqueHandle(name) {
      let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 26);
      if (!/^[a-z]/.test(base) || base.length < 2 || ["owner", "relay", "all", "any", "admin", "me"].includes(base)) base = "agent-" + base;
      let value = base, n = 2;
      while (overview.agents.some((a) => a.handle === value || a.id === value)) value = base + "-" + n++;
      return value;
    }
    const creating = new Map();
    // A tap inside the app arms one add; links and sign-in intents only ask.
    let armedIntent = null;
    const arm = id => () => { armedIntent = id; };
    function confirmIntent(platformId) {
      const add = el("button", { type: "button", class: "btn lg block" }, "Add " + labelOf(platformId));
      add.addEventListener("click", () => { armedIntent = platformId; render(); });
      return el("div", { class: "setup" }, flowTop("#/add", "All assistants"), route2(tile(platformId, "lg"), busTile()),
        el("h1", { class: "h1" }, "Add " + labelOf(platformId) + " to Hitchhike"), el("p", { class: "lead" }, "It gets its own connection in your workspace. Next you’ll see the one step to do in " + labelOf(platformId) + "."),
        el("div", { class: "dock stack" }, add, el("a", { class: "alt", href: "#/add" }, "Choose another assistant")));
    }
    // One tap adds an assistant with today's defaults. Repeating the intent
    // (back, reload, or a second device) reopens the same connection.
    async function connectIntent(platformId) {
      const armed = armedIntent === platformId, valid = platformId && (LABELS[platformId] || platformOf(platformId));
      armedIntent = null;
      if (!valid) { route("#/add", true); return null; }
      const found = existingFor(platformId);
      if (found) { route(agentHref(found), true); return null; }
      if (!armed) return confirmIntent(platformId);
      main.replaceChildren(el("div", { class: "setup", role: "status" }, flowTop("#/add", "All assistants"), route2(tile(platformId, "lg"), busTile()), el("h1", { class: "h1" }, "Adding " + labelOf(platformId) + "…"), el("p", { class: "lead" }, "Making room for it in your workspace.")));
      const generation = epoch;
      try {
        const agent = await createConnection(platformId);
        if (generation === epoch) route("#/setup/" + encodeURIComponent(agent.id), true);
        return null;
      } catch (e) {
        if (e.code === "auth" || generation !== epoch) return null;
        return el("div", { class: "setup" }, flowTop("#/add", "All assistants"), el("h1", { class: "h1" }, "Couldn’t add " + labelOf(platformId)), el("p", { class: "lead" }, e.message), el("div", { class: "actions" }, btn("Try again", () => { armedIntent = platformId; render(); }), btn("Choose another", "#/add", true)));
      }
    }
    function createConnection(platformId) {
      if (creating.has(platformId)) return creating.get(platformId);
      const job = (async () => {
        const name = labelOf(platformId), defaults = platformOf(platformId)?.defaults || {};
        let out;
        try {
          out = await api("/v1/admin/agents", { method: "POST", body: { id: uniqueHandle(name), name, platform: platformId, ...defaults, can_request: true, can_work: true } });
        } catch (e) {
          // A response lost after the write still created the connection.
          if (e.code === "auth") throw e;
          await fetchOverview().catch(() => {});
          const saved = existingFor(platformId);
          if (saved) return saved;
          throw e;
        }
        const id = out.agent.id;
        if (out.pairing && out.guide) {
          const instructions = guideSteps(out.guide).map(step => step.copy).find(copy => typeof copy === "string" && copy.includes(" /v1/pair"));
          if (instructions) pairing.set(id, { expires_at: out.pairing.expires_at, instructions });
        }
        await api("/v1/agents/" + encodeURIComponent(id) + "/onboarding", { method: "PATCH", body: { provider: platformId, ...(platformId === "codex" ? { surface: "terminal" } : {}), step: "connect" } }).catch(() => {});
        if (GOOD_AT[platformId]) {
          const minutes = SCHEDULE_DEFAULT[platformId] || null;
          await api("/v1/agents/" + encodeURIComponent(id) + "/collaboration", { method: "PUT", body: { expected_version: 0, purpose: GOOD_AT[platformId], setup_background: { enabled: !!minutes, interval_minutes: minutes } } })
            .then(value => { configs.set(id, value); configFetchedAt.set(id, Date.now()); }).catch(() => {});
        }
        await fetchOverview();
        return overview.agents.find(a => a.id === id) || out.agent;
      })();
      creating.set(platformId, job);
      job.then(() => creating.delete(platformId), () => creating.delete(platformId));
      return job;
    }
    async function configuration(id, force = false) {
      if (configs.has(id) && (readPauseUntil > Date.now() || (!force && Date.now() - (configFetchedAt.get(id) || 0) < CONFIG_MAX_AGE))) return configs.get(id);
      if (configRequests.has(id)) return configRequests.get(id);
      const generation = epoch;
      const request = api("/v1/agents/" + encodeURIComponent(id) + "/collaboration").then(value => {
        if (generation === epoch) {
          const previous = configs.get(id);
          if (previous && (previous.version !== value.version || previous.onboarding.surface !== value.onboarding.surface || previous.onboarding.provider !== value.onboarding.provider)) {
            for (const key of guides.keys()) if (key === id || key.startsWith(id + ":")) guides.delete(key);
          }
          configs.set(id, value); configFetchedAt.set(id, Date.now());
        }
        return value;
      });
      configRequests.set(id, request);
      try { return await request; } finally { if (configRequests.get(id) === request) configRequests.delete(id); }
    }
    async function getGuide(id, surface, force = false) {
      const a = overview?.agents.find(agent => agent.id === id);
      const version = JSON.stringify([configs.get(id)?.version ?? 0, configs.get(id)?.settings?.setup_background ?? null, a?.name, a?.platform, a?.can_request, a?.can_work]);
      const key = id + ":" + (surface || "") + ":" + version;
      if (!force && guides.has(key)) return guides.get(key);
      const generation = epoch;
      const response = await api("/v1/admin/agents/" + encodeURIComponent(id) + "/setup?surface=" + encodeURIComponent(surface || ""));
      if (generation !== epoch) throw Object.assign(new Error("Your session changed. Reopen this page."), { code: "auth" });
      if (response.guide) guides.set(key, response.guide);
      return response.guide;
    }
    function forgetGuides(id) {
      for (const key of guides.keys()) if (key === id || key.startsWith(id + ":")) guides.delete(key);
    }
    function guideSteps(g, surface) {
      const chosen = surface && g?.surfaces?.find(item => item.id === surface);
      return [...(chosen?.steps || []), ...(g?.steps || []), ...((g?.surfaces || []).flatMap(item => item.steps || []))];
    }
    function mcpUrl(g) {
      return guideSteps(g).map(step => (step.copy || "").trim()).find(text => /^https?:\/\/\S+$/.test(text)) || null;
    }
    function terminalCommand(g, platform) {
      const prefix = platform === "codex" ? "codex mcp add" : "claude mcp add";
      return guideSteps(g, "terminal").map(step => (step.copy || "").trim()).find(text => text.startsWith(prefix)) || null;
    }
    function requestedInterval(a, c) {
      const saved = c?.settings?.setup_background;
      if (saved) return saved.enabled ? saved.interval_minutes : null;
      if (c && c.version > 0 && c.settings?.background) return c.settings.background.method === "scheduled" ? c.settings.background.interval_minutes : null;
      return SCHEDULED[a.platform] || null;
    }
    // One plain status per assistant, from what Hitchhike has actually observed.
    function assistantStatus(a) {
      if (!a.last_seen_at) return { text: COMPUTER.has(a.platform) ? "Finish on your computer" : "Not connected yet", dot: "wait", warn: true };
      const c = configs.get(a.id), minutes = routine(a) ? requestedInterval(a, c) : c?.readiness?.background?.verified ? c.settings?.background?.interval_minutes : null;
      const age = (Date.now() - Date.parse(a.last_seen_at)) / 60e3;
      if (minutes) return age <= minutes * 3 + 5 ? { text: "Checks every " + every(minutes), dot: "ok" } : { text: "Last checked " + ago(a.last_seen_at), dot: "wait", warn: true };
      return { text: "Active " + ago(a.last_seen_at), dot: age < 1440 ? "ok" : "idle" };
    }
    function statusLine(a) {
      const s = assistantStatus(a);
      return el("span", { class: "st" + (s.warn ? " warn" : "") }, el("span", { class: s.dot }), s.text);
    }
    function exchanged() {
      return overview.jobs.some(j => j.status === "completed" && j.from && j.from !== "owner" && j.to && j.to !== "owner" && j.to !== "*" && j.from !== j.to)
        || [...configs.values()].some(c => c?.readiness?.peer_collaboration?.verified);
    }
    function board(pair, title, sub, ...rest) {
      return el("section", { class: "board", "aria-labelledby": "next-head" }, el("div", { class: "bhead" }, el("p", { class: "kicker" }, el("span", { class: "dot" }), "Next stop"), el("span", { class: "link", "aria-hidden": "true" }, pair[0], el("span", { class: "track" }), pair[1])),
        el("h2", { id: "next-head" }, title), el("p", { class: "sub" }, sub), rest);
    }
    const byRecent = (x, y) => Date.parse(y.last_seen_at) - Date.parse(x.last_seen_at);
    function handoffSenders(agents) {
      return agents.filter(a => a.last_seen_at && a.can_request).sort((x, y) => Number(routine(x)) - Number(routine(y)) || byRecent(x, y));
    }
    function nextStop() {
      const agents = overview.agents, live = agents.filter(a => a.last_seen_at);
      if (!live.length || exchanged()) return null;
      if (agents.length === 1) {
        const a = live[0];
        return board([tile(a.platform, "mini", a.name), el("span", { class: "mini empty" }, svg("plus"))], "Add a second assistant", a.name + " is connected. Hitchhike gets useful once it has another assistant to hand work to.", el("a", { class: "amber lg", href: "#/add" }, "Add an assistant"));
      }
      // Suggest only a pair the relay accepts. The sender's roster already applies both
      // sides' sending and receiving, collaborators and a category one may send and the
      // other takes on; without a loaded roster there is no card rather than a guess.
      let sender = null, receiver = null;
      for (const candidate of handoffSenders(agents)) {
        receiver = (configs.get(candidate.id)?.roster || []).filter(peer => peer.work_categories?.length)
          .map(peer => agents.find(a => a.id === peer.id && a.id !== candidate.id && a.last_seen_at)).filter(Boolean)
          .sort((x, y) => Number(routine(y)) - Number(routine(x)) || byRecent(x, y))[0] || null;
        if (receiver) { sender = candidate; break; }
      }
      if (!receiver) return null;
      const prompt = "Ask " + receiver.name + " for a second opinion on this and bring back its answer.";
      const minutes = routine(receiver) ? requestedInterval(receiver, configs.get(receiver.id)) : null;
      const quote = el("p", {}, "“" + prompt + "”"), copyButton = el("button", { type: "button", class: "amber" }, el("span", {}, "Copy"));
      copyButton.addEventListener("click", () => copyText(prompt, copyButton, quote));
      return board([tile(sender.platform, "mini", sender.name), tile(receiver.platform, "mini", receiver.name)], "Try your first handoff", sender.name + " and " + receiver.name + " are connected. In " + sender.name + ", say:",
        el("div", { class: "quote" }, quote, copyButton),
        el("p", { class: "fine" }, minutes ? receiver.name + " checks every " + every(minutes) + ", so its answer can take " + (minutes <= 15 ? "a few minutes." : "a while.") : "Then open " + receiver.name + " and ask it to check Hitchhike for requests."));
    }
    function homePage() {
      const agents = overview.agents;
      if (!agents.length) return chooserPage(false);
      const failures = overview.jobs.filter((j) => j.status === "failed" && Date.now() - Date.parse(j.updated_at) < 864e5);
      return el("div", { class: "home narrow" }, el("h1", { class: "h1" }, "Your assistants"), nextStop(),
        failures.length ? note("A handoff needs attention", "Open Activity to see what happened and how to recover.", el("a", { class: "pill on-white", href: "#/activity" }, "Activity"), "error") : null,
        el("div", { class: "group" }, agents.map(a => el("a", { class: "row", href: agentHref(a) }, tile(a.platform, "", a.name), el("span", { class: "rt" }, el("b", {}, a.name), statusLine(a)), svg("chev", "chev"))),
          el("a", { class: "row short", href: "#/add" }, el("span", { class: "tile add" }, svg("plus")), el("span", { class: "rt" }, el("b", { class: "add-label" }, "Add an assistant")))));
    }
    // Live setup status: quick at first, then slower, paused while hidden.
    let watch = null;
    function stopWatch() {
      if (watch) clearTimeout(watch.timer);
      watch = null;
    }
    function watchConnection(id) {
      stopWatch();
      const a = overview.agents.find(x => x.id === id);
      if (!a || a.last_seen_at) return;
      watch = { id, started: Date.now(), page: routeEpoch, timer: null, paused: false };
      watch.timer = setTimeout(checkConnection, 4e3);
    }
    function resumeWatch() {
      if (!watch) return;
      watch.paused = false;
      clearTimeout(watch.timer);
      watch.timer = setTimeout(checkConnection, 300);
    }
    async function checkConnection() {
      const current = watch;
      if (!current || current.page !== routeEpoch || !signedIn) return;
      if (document.hidden) { current.paused = true; return; }
      try {
        const out = await api("/v1/admin/agents");
        if (watch !== current || current.page !== routeEpoch) return;
        for (const fresh of out.agents || []) {
          const index = overview.agents.findIndex(a => a.id === fresh.id);
          if (index >= 0) overview.agents[index] = { ...overview.agents[index], ...fresh };
        }
        if (overview.agents.find(a => a.id === current.id)?.last_seen_at) { updateSetupStatus(current.id); renderSideAgents(); watch = null; return; }
      } catch (e) {
        if (e.code === "auth") return;
      }
      if (watch !== current) return;
      const elapsed = Date.now() - current.started;
      const delay = elapsed < 60e3 ? 4e3 : elapsed < 180e3 ? 8e3 : elapsed < 600e3 ? 15e3 : elapsed < 1800e3 ? 30e3 : elapsed < 3600e3 ? 60e3 : 0;
      if (delay) current.timer = setTimeout(checkConnection, Math.max(delay, readPauseUntil - Date.now()));
      else watch = null;
    }
    function ledInner(a) {
      if (a.last_seen_at) return el("a", { class: "led on", href: "#/agents" }, el("span", { class: "dot" }), a.name + " is connected", el("span", { class: "go" }, "Done", svg("chev")));
      return el("div", { class: "led" }, el("span", { class: "dot" }), "Waiting for " + a.name + (routine(a) || CODE.has(a.platform) ? "…" : " to connect…"));
    }
    function ledNode(a) {
      return el("div", { class: "ledwrap", id: "setup-led", role: "status", "aria-live": "polite", "data-on": a.last_seen_at ? "true" : "false" }, ledInner(a));
    }
    function updateSetupStatus(id) {
      const a = overview?.agents.find(x => x.id === id), current = $("#setup-led");
      if (!a || !current) return;
      if ((current.getAttribute("data-on") === "true") === !!a.last_seen_at) return;
      const inner = ledInner(a);
      if (a.last_seen_at) setClass(inner, "lit", true);
      current.setAttribute("data-on", a.last_seen_at ? "true" : "false");
      current.replaceChildren(inner);
      const link = $("#setup-link");
      if (link && a.last_seen_at) setClass(link, "done", true);
      $("#pair-renew")?.remove();
    }
    function helpToggle(label, items) {
      const panel = el("div", { class: "help", id: "setup-help", hidden: true }, el("ul", {}, items.map(item => el("li", {}, item))));
      const toggle = el("button", { type: "button", class: "ghost", "aria-expanded": "false", "aria-controls": "setup-help" }, label, svg("down"));
      toggle.addEventListener("click", () => { const open = toggle.getAttribute("aria-expanded") !== "true"; toggle.setAttribute("aria-expanded", String(open)); panel.hidden = !open; });
      return [toggle, panel];
    }
    function stations(steps, end) {
      return el("ol", { class: "route" }, steps.map((step, i) => el("li", { class: "stop" }, el("span", { class: "node" }, i + 1), el("p", {}, rich(step)))),
        el("li", { class: "stop" }, el("span", { class: "node end" }), el("p", {}, rich(end[0]), end[1] ? el("small", {}, end[1]) : null)));
    }
    function copyField(url) {
      const parsed = (() => { try { return new URL(url); } catch { return null; } })();
      const value = el("span", { class: "url", title: url }, parsed ? [parsed.host, el("i", {}, parsed.pathname)] : url);
      const button = el("button", { type: "button", class: "btn sm", "aria-label": "Copy link" }, svg("copy"), el("span", {}, "Copy"));
      button.addEventListener("click", () => copyText(url, button, value));
      return el("div", { class: "field" }, value, button);
    }
    const SAY = name => ["Say ", ["“Set up Hitchhike”"], " in " + name];
    function mcpCopy(a) {
      const connect = ["Connect " + a.name];
      if (OPENAI.has(a.platform)) return {
        lead: "Copy this link, then add it in ChatGPT on a computer.", where: "In ChatGPT on the web",
        steps: [["Open ", ["Settings → Security and login"], " and turn on ", ["Developer mode"]], ["Open ", ["Plugins"], ", choose ", ["Add (+)"], " and paste the link"], ["Sign in and click ", connect]],
        end: [["Say ", ["“Set up Hitchhike”"], " in ChatGPT"], "Dots and Codex use the same plugin."],
        help: ["Don’t see Developer mode?", ["Developer mode and custom plugins are on ChatGPT’s website, on a computer. Once Hitchhike is added there, it works in the ChatGPT app on your phone too.", "Work and school accounts may need an admin to allow custom plugins.", "In Dots, open your dot’s profile → Customize → Plugins and select Hitchhike.", el("span", {}, "Using the Codex CLI on its own? ", el("a", { href: "#/connect/codex", onclick: arm("codex") }, "Set up Codex"), ".")]],
      };
      if (a.platform === "grok") return {
        lead: "Copy this link, then add it in Grok.", where: "In Grok",
        steps: [["Open ", ["grok.com/connectors"]], ["Choose ", ["New Connector → Custom"], " and paste the link"], ["Sign in and tap ", connect]],
        end: [SAY("Grok")],
        help: ["Can’t add a connector?", ["Business and Enterprise accounts may need an admin to allow custom connectors.", "Grok chat and Grok Bot connect separately. Add Grok Bot from Your assistants."]],
      };
      return {
        lead: "Copy this link, then add it in the Claude app.", where: "In the Claude app",
        steps: [["Open ", ["Settings → Connectors"]], ["Tap ", ["Add custom connector"], " and paste the link"], ["Sign in and tap ", connect]],
        end: [["Say ", ["“Set up Hitchhike”"], " in any Claude chat"], "It works in Claude Duet too."],
        help: ["Don’t see Add custom connector?", ["On iPhone it’s under Settings → Connectors → +. On a computer, it’s Settings → Connectors at claude.ai.", "If your phone doesn’t show it, add Hitchhike once at claude.ai on a computer. Every Claude app on your account, Duet included, then has it.", "Team and Enterprise plans may need an admin to allow custom connectors.", "When Claude asks, allow Hitchhike’s tools. They only reach your own workspace."]],
      };
    }
    async function setupPage(id) {
      const a = overview.agents.find((x) => x.id === id);
      if (!a) throw new Error("This connection no longer exists. Choose another from Your assistants.");
      const c = await configuration(id, true).catch(e => { if (e.code === "auth") throw e; return configs.get(id) || null; });
      const g = await getGuide(id, c?.onboarding?.surface).catch(e => { if (e.code === "auth") throw e; return null; });
      if (routine(a)) return pairSetup(a, c, g);
      if (COMPUTER.has(a.platform) && isPhone()) return computerHandoff(a, g);
      if (CODE.has(a.platform)) return codeSetup(a, g);
      const copy = mcpCopy(a), url = mcpUrl(g);
      return el("div", { class: "setup" }, flowTop(), route2(tile(a.platform, "lg", a.name), busTile(), a.last_seen_at),
        el("h1", { class: "h1" }, "Add Hitchhike to " + a.name), el("p", { class: "lead" }, copy.lead),
        url ? copyField(url) : el("p", { class: "error-text" }, "This connection’s link isn’t available right now. Reload the page to try again."),
        el("h2", { class: "label steps" }, copy.where), stations(copy.steps, copy.end),
        el("div", { class: "dock" }, helpToggle(copy.help[0], copy.help[1])), ledNode(a));
    }
    function pasteLine(platform, command) {
      const [add, login] = command.split("\n").map(line => line.trim()).filter(Boolean);
      if (platform === "codex") return { text: "Add Hitchhike for me: run " + add + (login ? ", then tell me to run " + login + " and sign in." : ", then tell me to restart Codex."), marks: [add, login].filter(Boolean) };
      return { text: "Add Hitchhike for me: run " + add + (HOSTED ? ", then tell me to type /mcp and choose Hitchhike to sign in." : ", then tell me to type /mcp to check it’s connected."), marks: [add, "/mcp"] };
    }
    function marked(line) {
      const nodes = [];
      let rest = line.text;
      while (rest) {
        const hits = line.marks.map(mark => [rest.indexOf(mark), mark]).filter(([at]) => at >= 0).sort((x, y) => x[0] - y[0]);
        if (!hits.length) { nodes.push(rest); break; }
        const [at, mark] = hits[0];
        if (at) nodes.push(rest.slice(0, at));
        nodes.push(el("span", { class: "cmd" }, mark));
        rest = rest.slice(at + mark.length);
      }
      return nodes;
    }
    function codeSetup(a, g) {
      const command = terminalCommand(g, a.platform), line = command ? pasteLine(a.platform, command) : null, codex = a.platform === "codex";
      const body = el("p", {}, el("span", { class: "pr", "aria-hidden": "true" }, "›"), line ? marked(line) : "This connection’s command isn’t available right now. Reload the page to try again.", el("span", { class: "caret", "aria-hidden": "true" }));
      const copyLine = el("button", { type: "button", class: "btn" }, svg("copy"), el("span", {}, "Copy line"));
      if (line) copyLine.addEventListener("click", () => copyText(line.text, copyLine, body)); else copyLine.disabled = true;
      const segment = id => el("a", { href: "#/connect/" + id, "aria-current": a.platform === id ? "page" : null, onclick: arm(id) }, ASSETS["assets/agents/" + ART[id][0]] ? el("img", { src: ASSETS["assets/agents/" + ART[id][0]], alt: "" }) : null, labelOf(id));
      const manual = el("div", { class: "help", id: "run-yourself", hidden: true }, el("p", { class: "flush" }, "Run this in a terminal on the computer where you use " + a.name + "."), command ? copybox("Command", command) : null);
      const help = el("div", { class: "help", id: "mcp-help", hidden: true }, el("ul", {}, (codex
        ? ["Run codex mcp list to check Hitchhike was added.", "If sign-in didn’t finish, run codex mcp login hitchhike again.", "Using the ChatGPT plugin in Codex already? You don’t need this as well."]
        : ["Restart Claude Code, then type /mcp again.", "Run claude mcp list to check Hitchhike was added for your user.", "If an older Hitchhike entry exists, remove it with claude mcp remove hitchhike, then paste the line again."]).map(text => el("li", {}, text))));
      const reveal = (button, panel) => button.addEventListener("click", () => { const open = panel.hidden; panel.hidden = !open; button.setAttribute("aria-expanded", String(open)); });
      const runYourself = el("button", { type: "button", "aria-expanded": "false", "aria-controls": "run-yourself" }, "Or run it yourself"), missing = el("button", { type: "button", "aria-expanded": "false", "aria-controls": "mcp-help" }, codex ? "Don’t see Hitchhike in Codex?" : "Don’t see Hitchhike in /mcp?");
      reveal(runYourself, manual); reveal(missing, help);
      const steps = codex
        ? [["Paste the line and approve the command"], HOSTED ? ["Run ", ["codex mcp login hitchhike"], " and click ", ["Connect " + a.name], " in your browser"] : ["Restart Codex so it loads Hitchhike"]]
        : [["Paste the line and approve the command"], HOSTED ? ["Type ", ["/mcp"], ", pick Hitchhike and click ", ["Connect " + a.name], " in your browser"] : ["Type ", ["/mcp"], " to check Hitchhike is connected"]];
      return el("div", { class: "setup-split" },
        el("section", { class: "copy" }, flowTop(), route2(tile(a.platform, "lg", a.name), busTile(), a.last_seen_at), el("h1", { class: "h1" }, "Add Hitchhike to " + a.name), el("p", { class: "lead" }, "Paste one line into " + a.name + ". It adds Hitchhike for you."),
          el("nav", { class: "seg", "aria-label": "Coding assistant" }, segment("claude-code"), segment("codex")),
          stations(steps, [SAY(a.name)]), el("div", { class: "aux" }, runYourself, missing), manual, help),
        el("section", { class: "side" }, el("div", { class: "term" }, el("div", { class: "tbar" }, el("span", { class: "lights", "aria-hidden": "true" }, el("i", {}), el("i", {}), el("i", {})), el("span", { class: "ttitle" }, a.name), copyLine), el("div", { class: "tbody" }, body)), ledNode(a)));
    }
    function computerHandoff(a, g) {
      const command = CODE.has(a.platform) ? terminalCommand(g, a.platform) : null, line = command ? pasteLine(a.platform, command) : null;
      const page = location.origin + location.pathname + "#/setup/" + encodeURIComponent(a.id), shown = page.replace(/^https?:\/\//, "");
      const text = line ? line.text : "Add Hitchhike to " + a.name + " from a computer: open this link, sign in, and follow the three steps.";
      const message = el("p", {}, text), share = el("button", { type: "button", class: "btn lg block" }, svg("share"), el("span", {}, "Send to my computer")), copyInstead = el("button", { type: "button", class: "btn quiet lg block" }, el("span", {}, "Copy instead"));
      share.addEventListener("click", () => shareText({ title: "Add Hitchhike to " + a.name, text, url: page }, share, message, text + "\n" + page));
      copyInstead.addEventListener("click", () => copyText(text + "\n" + page, copyInstead, message));
      const lead = OPENAI.has(a.platform) ? "ChatGPT adds Hitchhike from its website, so start there. Once it’s added, it works on this phone too." : a.name + " runs on your computer, so that’s where Hitchhike gets added. Send yourself this and pick up there.";
      return el("div", { class: "setup handoff" }, flowTop(),
        el("div", { class: "trip", "aria-hidden": "true" }, el("span", { class: "stn" }, el("span", { class: "ring" }, svg("phone")), el("small", {}, "This phone")), el("span", { class: "line" }), el("span", { class: "stn" }, el("span", { class: "ring on" }, svg("computer")), el("small", {}, "Your computer"))),
        el("h1", { class: "h1" }, a.name + " needs a computer once"), el("p", { class: "lead" }, lead),
        el("figure", { class: "msg" }, el("figcaption", {}, el("span", { class: "who" }, tile(a.platform, "mini", a.name), line ? "Paste this into " + a.name + " on your computer" : "Open this on your computer")), message, el("span", { class: "url-line" }, shown)),
        el("div", { class: "dock stack" }, share, copyInstead, el("a", { class: "alt", href: "#/add" }, "Add an assistant that works on this phone"), el("p", { class: "foot" }, "Sign in there with the same account.")), ledNode(a));
    }
    function pairSetup(a, c, g) {
      const minutes = requestedInterval(a, c), scheduled = !!SCHEDULED[a.platform], hostedPairing = HOSTED, pageEpoch = routeEpoch;
      const issuedKey = "hitchhike:pairing-issued:" + (session?.workspace?.id || "selfhost") + ":" + a.id + ":" + (a.created_at || "");
      const message = el("p", { id: "pair-message", class: "clamp" }, hostedPairing ? "Getting a fresh one-time code…" : "");
      const whole = el("button", { type: "button", class: "more-text", "aria-controls": "pair-message", "aria-expanded": "false" }, "Show the whole message");
      whole.addEventListener("click", () => { whole.dataset.opened = "true"; setClass(message, "clamp", false); whole.hidden = true; });
      const copyButton = el("button", { type: "button", class: "btn lg", disabled: true }, svg("copy"), el("span", {}, "Copy message"));
      const shareButton = el("button", { type: "button", class: "ib lg", "aria-label": "Share message", disabled: true }, svg("share"));
      const error = errorBox();
      let text = "", renewTimer = null;
      const ready = value => {
        text = value || "";
        message.textContent = text || "This message isn’t available right now. Reload the page to try again.";
        setClass(message, "aside", !text); setClass(message, "clamp", !!text && !whole.dataset.opened);
        whole.hidden = !text || !!whole.dataset.opened;
        copyButton.disabled = shareButton.disabled = !text;
      };
      copyButton.addEventListener("click", () => copyText(text, copyButton, message));
      shareButton.addEventListener("click", () => shareText({ title: "Message for " + a.name, text }, shareButton, message, text));
      const renewLater = expiresAt => {
        clearTimeout(renewTimer);
        // Replace a code only once it has expired, so a copied message stays valid.
        renewTimer = setTimeout(() => { if (pageEpoch === routeEpoch && !overview?.agents.find(x => x.id === a.id)?.last_seen_at) issue(); }, Math.min(2147483647, Math.max(1e3, Date.parse(expiresAt) - Date.now())));
      };
      async function issue() {
        if (!hostedPairing) { const fresh = await getGuide(a.id, c?.onboarding?.surface, true).catch(() => g); ready(guideSteps(fresh).find(step => step.title === "Pair this agent" && step.copy)?.copy); return; }
        error.hidden = true;
        try {
          const held = pairing.get(a.id);
          const out = held && Date.parse(held.expires_at) > Date.now() + 30e3 ? held : await api("/v1/admin/agents/" + encodeURIComponent(a.id) + "/pairing", { method: "POST", body: {} });
          pairing.set(a.id, { expires_at: out.expires_at, instructions: out.instructions });
          tabMemory.set(issuedKey, out.expires_at);
          if (pageEpoch !== routeEpoch) return;
          ready(out.instructions);
          renewLater(out.expires_at);
        } catch (e) {
          if (e.code === "auth") return;
          ready(""); showError(error, e);
        }
      }
      const intervalLabel = el("span", { class: "slab" }, minutes ? "Checks every " + every(minutes) : "Checks when you ask");
      const select = el("select", { "aria-label": "How often " + a.name + " checks for requests" }, [...INTERVALS.map(value => el("option", { value: String(value), selected: value === minutes }, "Every " + every(value))), el("option", { value: "off", selected: !minutes }, "Only when I ask")]);
      select.addEventListener("change", async () => {
        const enabled = select.value !== "off", value = enabled ? Number(select.value) : null;
        select.disabled = true;
        try {
          const latest = await configuration(a.id, true);
          const out = await api("/v1/agents/" + encodeURIComponent(a.id) + "/collaboration", { method: "PUT", body: { expected_version: latest.version, setup_background: { enabled, interval_minutes: value } } });
          configs.set(a.id, out); configFetchedAt.set(a.id, Date.now()); forgetGuides(a.id); pairing.delete(a.id);
          intervalLabel.textContent = enabled ? "Checks every " + every(value) : "Checks when you ask";
          lead.textContent = leadText(enabled ? value : null);
          await issue();
          toast("Updated. Send " + a.name + " the new message; the earlier one no longer works.");
        } catch (e) { if (e.code !== "auth") showError(error, e); }
        finally { select.disabled = false; }
      });
      const leadText = value => "Send " + a.name + " this message. It connects itself and " + (scheduled ? (value ? "checks for requests every " + every(value) + "." : "checks for requests when you ask.") : "checks in on its own schedule.");
      const lead = el("p", { class: "lead" }, leadText(minutes));
      const connected = !!a.last_seen_at;
      const node = el("div", { class: "setup" }, flowTop(), route2(tile(a.platform, "lg", a.name), busTile(), connected),
        el("h1", { class: "h1" }, "Add " + a.name), lead,
        el("figure", { class: "msg" }, el("figcaption", {}, "Message for " + a.name, el("span", { class: "code" }, svg("lock"), hostedPairing ? "One-time code" : "Private key")), message, whole),
        el("div", { class: "msg-acts" }, copyButton, shareButton),
        el("p", { class: "foot", id: "pair-renew" }, hostedPairing ? "This code works once. It renews while this page is open." : "This message holds a private key. Send it only to " + a.name + "."),
        error,
        scheduled ? el("div", { class: "setting" }, svg("clock"), intervalLabel, el("span", { class: "picker" }, el("span", { class: "pill on-white", "aria-hidden": "true" }, "Change"), select)) : null,
        el("div", { class: "dock" }), ledNode(a));
      const offerNew = text2 => {
        message.textContent = text2;
        setClass(message, "aside", true); setClass(message, "clamp", false); whole.hidden = true;
        const again = el("button", { type: "button", class: "pill on-white again" }, "Make a new message");
        again.addEventListener("click", () => { again.remove(); setClass(message, "aside", false); message.textContent = "Getting a fresh one-time code…"; issue(); });
        message.parentNode?.append(again);
      };
      const held = pairing.get(a.id), recent = Date.parse(tabMemory.get(issuedKey) || "") > Date.now();
      if (!hostedPairing) ready(guideSteps(g).find(step => step.title === "Pair this agent" && step.copy)?.copy);
      else if (connected) offerNew(a.name + " is already connected. Make a new message only if you need to pair it again.");
      // A reload must not silently replace a code someone may have just sent.
      else if (recent && !(held && Date.parse(held.expires_at) > Date.now() + 30e3)) offerNew("You made a message for " + a.name + " a few minutes ago, and it still works. If you didn’t send it, make a new one; the earlier message then stops working.");
      else issue();
      return node;
    }
    async function assistantPage(id) {
      const a = overview.agents.find((x) => x.id === id);
      if (!a) throw new Error("This connection is unavailable.");
      const c = await configuration(id, true), s = c.settings, error = errorBox();
      const saved = el("span", { class: "saved", role: "status", "aria-live": "polite" });
      // Fields whose failed edit is still on screen; "Saved" waits until they save.
      let chain = Promise.resolve(), pending = 0;
      const unsaved = new Set();
      const mark = (state) => {
        saved.replaceChildren(...(state === "busy" ? ["Saving…"] : state === "done" ? [svg("check"), "Saved"] : state === "failed" ? ["Couldn’t save"] : []));
        saved.className = "saved" + (state === "busy" ? " busy" : state === "failed" ? " failed" : "");
      };
      mark("done");
      // Saves run one at a time so each uses the latest settings version.
      function queue(work, key) {
        pending++; mark("busy"); if (!unsaved.size) error.hidden = true;
        const run = chain.then(work).then(() => {
          if (key) unsaved.delete(key);
          if (--pending === 0) { mark(unsaved.size ? "failed" : "done"); if (!unsaved.size) error.hidden = true; }
        }, e => { pending--; if (key) unsaved.add(key); mark("failed"); if (e.code !== "auth") showError(error, e); throw e; });
        chain = run.catch(() => {});
        return run;
      }
      const saveAgent = changes => queue(async () => {
        const out = await api("/v1/admin/agents", { method: "POST", body: { id, ...changes } });
        const index = overview.agents.findIndex(x => x.id === id);
        if (index >= 0) overview.agents[index] = { ...overview.agents[index], ...(out.agent || changes) };
        forgetGuides(id); renderSideAgents();
      });
      const saveSettings = (patch, key) => queue(async () => {
        const write = version => api("/v1/agents/" + encodeURIComponent(id) + "/collaboration", { method: "PUT", body: { expected_version: version, ...patch } });
        let out;
        try { out = await write(configs.get(id).version); }
        catch (e) { if (e.status !== 409) throw e; out = await write((await configuration(id, true)).version); }
        configs.set(id, out); configFetchedAt.set(id, Date.now());
      }, key);
      const title = el("h1", { class: "h1", id: "agent-name" }, a.name);
      const headStatus = () => {
        if (!a.last_seen_at) return el("p", { class: "st warn" }, el("span", { class: "wait" }), "Not connected yet · ", el("a", { href: "#/setup/" + encodeURIComponent(id) }, "Finish setting up"));
        const status = assistantStatus(a), detail = status.text.startsWith("Checks") ? status.text.toLowerCase() : status.text.startsWith("Last") ? status.text.toLowerCase() : "checks when you ask";
        return el("p", { class: "st" + (status.warn ? " warn" : "") }, el("span", { class: status.dot === "idle" ? "idle" : status.dot }), "Connected · " + detail);
      };
      const pencil = el("button", { type: "button", class: "ib", "aria-label": "Rename " + a.name }, svg("pencil"));
      const nameBlock = el("div", {}, el("div", { class: "namerow" }, title, pencil), headStatus());
      const rename = el("button", { type: "button", class: "pill lg" }, "Rename");
      pencil.addEventListener("click", () => rename.click());
      rename.addEventListener("click", () => {
        const input = el("input", { value: a.name, maxlength: "80", "aria-label": "Name", autocomplete: "off", spellcheck: "false" }), done = el("button", { type: "button", class: "pill lg" }, "Done");
        const form = el("form", { class: "rename" }, input, done);
        const finish = async (keep) => {
          const value = input.value.trim();
          form.replaceWith(nameBlock); rename.hidden = false;
          if (!keep || !value || value === a.name) return;
          const previous = a.name;
          a.name = value; title.textContent = value; document.title = value + " · Hitchhike";
          try { await saveAgent({ name: value }); $("#crumb-name") && ($("#crumb-name").textContent = value); }
          catch { a.name = previous; title.textContent = previous; }
        };
        form.addEventListener("submit", e => { e.preventDefault(); finish(true); });
        done.addEventListener("click", () => finish(true));
        input.addEventListener("keydown", e => { if (e.key === "Escape") finish(false); });
        nameBlock.replaceWith(form); rename.hidden = true; input.focus(); input.select?.();
      });
      const goodAt = el("input", { id: "good-at", class: "input", value: s.purpose || "", placeholder: GOOD_AT[a.platform] ? "For example, " + GOOD_AT[a.platform].charAt(0).toLowerCase() + GOOD_AT[a.platform].slice(1) : "What it’s good at", maxlength: "1200", autocomplete: "off" });
      // Only a save the server accepted moves savedPurpose, so after a failure the
      // next change or blur sends the same text again.
      let purposeTimer = null, savedPurpose = s.purpose || "", sendingPurpose = null;
      const flushPurpose = () => {
        clearTimeout(purposeTimer);
        const value = goodAt.value.trim();
        if (value === sendingPurpose || (value === savedPurpose && sendingPurpose === null && !unsaved.has("purpose"))) return;
        sendingPurpose = value;
        saveSettings({ purpose: value }, "purpose").then(() => { savedPurpose = value; }, () => {}).finally(() => { if (sendingPurpose === value) sendingPurpose = null; });
      };
      goodAt.addEventListener("input", () => { clearTimeout(purposeTimer); purposeTimer = setTimeout(flushPurpose, 900); });
      goodAt.addEventListener("change", flushPurpose); goodAt.addEventListener("blur", flushPurpose);
      const toggle = (labelId, title2, detail, key) => {
        const button = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": a[key] ? "true" : "false", "aria-labelledby": labelId }, el("i", {}));
        button.addEventListener("click", async () => {
          const next = button.getAttribute("aria-checked") !== "true";
          button.setAttribute("aria-checked", String(next)); button.disabled = true;
          try { await saveAgent({ [key]: next }); a[key] = next; }
          catch { button.setAttribute("aria-checked", String(!next)); }
          finally { button.disabled = false; }
        });
        return el("div", { class: "row" }, el("span", { class: "rt" }, el("b", { id: labelId }, title2), el("span", {}, detail)), button);
      };
      const advanced = el("div", { class: "advanced", id: "advanced", hidden: true });
      const advButton = el("button", { type: "button", class: "adv", "aria-expanded": "false", "aria-controls": "advanced" }, el("span", { class: "rt" }, el("b", {}, "Advanced"), el("span", {}, "Who it works with, kinds of work, remove")), svg("down", "chev"));
      let built = false;
      advButton.addEventListener("click", async () => {
        const open = advButton.getAttribute("aria-expanded") !== "true";
        advButton.setAttribute("aria-expanded", String(open)); advanced.hidden = !open;
        if (open && !built) { built = true; await buildAdvanced(); }
      });
      async function buildAdvanced() {
        const settings = configs.get(id).settings, peers = overview.agents.filter(x => x.id !== id);
        const everyone = settings.permitted_collaborators.includes("*");
        const all = el("input", { type: "checkbox", checked: everyone });
        const boxes = peers.map(peer => ({ peer, input: el("input", { type: "checkbox", value: peer.id, checked: everyone || settings.permitted_collaborators.includes(peer.id), disabled: everyone }) }));
        // A failed save puts the checkboxes back to what is actually saved.
        let savedCollaborators = settings.permitted_collaborators;
        const showCollaborators = list => { all.checked = list.includes("*"); boxes.forEach(box => { box.input.checked = all.checked || list.includes(box.peer.id); box.input.disabled = all.checked; }); };
        const saveCollaborators = () => {
          boxes.forEach(box => { box.input.disabled = all.checked; if (all.checked) box.input.checked = true; });
          const list = all.checked ? ["*"] : boxes.filter(box => box.input.checked).map(box => box.peer.id);
          saveSettings({ permitted_collaborators: list }).then(() => { savedCollaborators = list; }, () => showCollaborators(savedCollaborators));
        };
        all.addEventListener("change", saveCollaborators);
        boxes.forEach(box => box.input.addEventListener("change", saveCollaborators));
        const chips = (key, chosen, after) => el("div", { class: "chips", role: "group" }, Object.entries(TYPE_LABELS).map(([type, label]) => {
          const tick = svg("check"), chip = el("button", { type: "button", "aria-pressed": chosen.includes(type) ? "true" : "false", "data-type": type }, tick, label);
          const show = on => { chip.setAttribute("aria-pressed", String(on)); tick.style.display = on ? "" : "none"; };
          show(chosen.includes(type));
          chip.addEventListener("click", () => {
            const on = chip.getAttribute("aria-pressed") !== "true";
            show(on);
            const values = $$("button", chip.parentNode).filter(item => item.getAttribute("aria-pressed") === "true").map(item => item.dataset.type);
            saveSettings({ [key]: values }).then(() => after?.(values), () => show(!on));
          });
          return chip;
        }));
        const reconnect = btn("Replace credentials", async () => {
          if (!confirm("Replace " + a.name + "’s credentials? Its current sign-in stops working, and you’ll connect it again.")) return;
          reconnect.disabled = true;
          try {
            await api("/v1/admin/agents", { method: "POST", body: { id, rotate_token: true } });
            forgetGuides(id); pairing.delete(id);
            await fetchOverview();
            route("#/setup/" + encodeURIComponent(id));
          } catch (e) { showError(error, e); } finally { reconnect.disabled = false; }
        }, true);
        const remove = el("button", { type: "button", class: "btn danger" }, "Remove " + a.name);
        remove.addEventListener("click", async () => {
          if (!confirm("Remove " + a.name + "? Its sign-in stops working and its open requests are canceled. Work already running in another app may continue.")) return;
          remove.disabled = true;
          try {
            await api("/v1/admin/agents/" + encodeURIComponent(id), { method: "DELETE" });
            configs.delete(id); pairing.delete(id); forgetGuides(id);
            await fetchOverview();
            route("#/agents");
          } catch (e) { showError(error, e); } finally { remove.disabled = false; }
        });
        advanced.append(
          el("h2", {}, "Who it works with"), el("p", {}, "Hitchhike only passes work between the assistants you allow."),
          el("div", { class: "checks" }, el("label", {}, all, el("span", { class: "who" }, el("span", {}, "All your assistants"), el("small", {}, "Including ones you add later"))), boxes.map(box => { const kind = box.peer.platform_label || labelOf(box.peer.platform); return el("label", {}, box.input, el("span", { class: "who" }, el("span", {}, box.peer.name), kind !== box.peer.name ? el("small", {}, kind) : null)); })),
          el("h2", {}, "Kinds of work"), el("p", {}, "Hitchhike enforces these. Each app still asks you before acting outside Hitchhike."),
          el("p", { class: "chip-label" }, "It can ask for"), chips("allowed_request_categories", settings.allowed_request_categories),
          el("p", { class: "chip-label" }, "It can take on"), chips("allowed_work_categories", settings.allowed_work_categories, values => saveAgent({ work_types: values }).catch(() => {})),
          el("h2", {}, "Connection"), el("p", {}, "Run setup again if " + a.name + " stops responding. Replacing credentials signs it out everywhere."),
          el("div", { class: "danger-zone" }, el("a", { class: "btn quiet", href: "#/setup/" + encodeURIComponent(id) }, "Setup steps"), reconnect, remove),
          el("p", { class: "idline" }, "Connection ID " + a.id));
        const cloud = a.platform === "claude-code" && c.onboarding?.surface === "cloud";
        try {
          const activation = await activationPanel(id, cloud);
          if (activation) advanced.append(activation);
        } catch (e) {
          if (e.code === "auth") throw e;
          advanced.append(note("Routine settings unavailable", e.message, null, "error"));
        }
      }
      return el("div", { class: "assistant" },
        el("div", { class: "crumbs" }, el("a", { href: "#/agents" }, "Your assistants"), el("span", { "aria-hidden": "true" }, "/"), el("span", { id: "crumb-name" }, a.name), saved),
        el("header", { class: "ahead" }, tile(a.platform, "xl", a.name), nameBlock, rename),
        el("section", { class: "form" }, el("label", { class: "flabel", for: "good-at" }, "Good at"), goodAt, el("p", { class: "hint" }, "Your other assistants read this when deciding whom to ask."),
          el("div", { class: "group switches" }, toggle("sw-ask", "Can ask your other assistants for help", a.name + " can hand work to them and bring the answer back.", "can_request"), toggle("sw-take", "Can take requests from them", "Your other assistants can send " + a.name + " work.", "can_work")),
          advButton, advanced, error));
    }
    function conversationState(c) {
      if (c.stopped_at) return {label:"Stopped",tone:"pending",attention:true};
      if (c.limit_reached) return {label:"Turn limit reached",tone:"pending",attention:true};
      const jobs = overview.jobs.filter((j) => j.conversation_id === c.id);
      const urgent = jobs.find((j) => ["input_required","needs_approval"].includes(j.status));
      const request = urgent || c.latest_request || jobs.sort((a,b) => Date.parse(b.created_at)-Date.parse(a.created_at))[0];
      if (!request) return {label:c.outstanding_requests ? "Open to see pickup status" : "Open to see request status",tone:"",attention:false};
      return {label:request.status === "completed" && request.retrieved_at ? "Retrieved" : statusNames[request.status] || request.status,tone:request.status === "failed" ? "failed" : ["input_required","needs_approval","expired"].includes(request.status) ? "pending" : request.status === "completed" ? "good" : "",attention:["input_required","needs_approval","failed","expired"].includes(request.status)};
    }
    async function activityPage() {
      const response = await api("/v1/conversations?limit=100"), conversations = Array.isArray(response) ? response : response.conversations || [], section = el("div", { class: "agent-list" }), filters = el("div", { class: "chips", "aria-label": "Filter activity" });
      let selected = "all";
      const empty = el("div", {});
      function rows() {
        section.replaceChildren();
        empty.replaceChildren();
        const shown = conversations.filter((c) => selected === "all" || selected === "open" && c.outstanding_requests > 0 || selected === "attention" && conversationState(c).attention || selected === "done" && c.outstanding_requests === 0);
        for (const c of shown) {
          const status = conversationState(c);
          section.append(el("a", { class: "activity-row", href: "#/conversations/" + encodeURIComponent(c.id) }, el("div", {}, el("strong", {}, c.title), el("p", {}, c.participants.map(who).join(" · "))), el("time", { datetime: c.last_message_at }, ago(c.last_message_at)), state(status.label, status.tone)));
        }
        if (!shown.length) empty.append(el("section", { class: "empty-state" }, el("h2", {}, conversations.length ? "Nothing in this view" : "The first handoff starts in your assistant."), el("p", {}, conversations.length ? "Try another filter." : "Ask a connected assistant to consult another. Their requests, questions and answers show up here."), btn("Your assistants", "#/agents", true)));
      }
      [["all", "All activity"], ["attention", "Needs attention"], ["open", "In progress"], ["done", "Completed"]].forEach(([value, label]) => filters.append(btn(label, () => {
        selected = value;
        $$("button", filters).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === value)));
        rows();
      }, true, { "aria-pressed": value === selected ? "true" : "false", "data-filter": value })));
      rows();
      const legacy = overview.jobs.filter((j) => !j.conversation_id);
      return el("div", { class: "wide" }, head("Activity", "What your assistants asked each other. Your conversations stay in the apps you use."), filters, section, empty, legacy.length ? el("details", {}, el("summary", {}, "Earlier tasks and connection tests"), el("div", { class: "agent-list" }, legacy.map((j) => el("a", { class: "activity-row", href: "#/jobs/" + encodeURIComponent(j.id) }, el("div", {}, el("strong", {}, j.title), el("p", {}, who(j.from) + " → " + who(j.to))), state(j.status === "completed" && j.retrieved_at ? "Retrieved" : statusNames[j.status] || j.status, j.status === "failed" ? "failed" : ""))))) : null, foot("Waiting means a request is queued. It doesn’t mean the receiving assistant is awake."));
    }
    function messageNode(m) {
      const result = m.result;
      return el("article", { class: "message" }, el("div", { class: "message-head" }, el("strong", {}, who(m.from) + " · " + m.kind), el("time", { datetime: m.created_at }, date(m.created_at))), el("div", { class: "message-body" }, m.text || result?.body || result?.summary || ""), result?.sources?.length ? el("ul", { class: "plain-list" }, result.sources.filter((s) => safeUrl(s.url)).map((s) => el("li", {}, el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url)))) : null);
    }
    function sharedContext(conversation) {
      const id = conversation.id, draft = contextDrafts.get(id), text = el("textarea", {rows:"6",maxlength:"20000",value:draft?.text ?? conversation.pinned_context ?? "",placeholder:"Approved background, instructions, or links for these participants…"}), error = errorBox();
      let expectedVersion = draft?.version ?? conversation.context_version ?? 0;
      const panel = el("details", {}, el("summary", {}, "Shared context"), el("p", {}, "Pin only context you deliberately approve for everyone in this conversation. Text and links travel with requests; this does not grant access to files or external actions."), field("Pinned text and links", text), error);
      text.addEventListener("input", () => { contextDrafts.set(id,{text:text.value,version:expectedVersion});dirty=true; });
      const reload = btn("Reload saved context", async () => { if (!confirm("Discard this unsaved draft and reload the saved shared context? Copy any text you want to keep first.")) return; contextDrafts.delete(id);dirty=contextDrafts.size>0;await render(false); }, true, {hidden:true});
      const save = btn("Save shared context", async () => {
        const saveEpoch = epoch;
        save.disabled=true;error.hidden=true;
        try {
          await api("/v1/conversations/"+encodeURIComponent(id)+"/context", {method:"PATCH",body:{pinned_context:text.value,expected_version:expectedVersion}});
          if (saveEpoch !== epoch) return;
          contextDrafts.delete(id);dirty=contextDrafts.size>0;toast("Shared context saved. The change is recorded in conversation history.");await render(false);
        } catch(e) {
          if (saveEpoch !== epoch) return;
          contextDrafts.set(id,{text:text.value,version:expectedVersion});dirty=true;
          showError(error,e.code === "context_changed" ? new Error("Shared context changed elsewhere. Your draft is kept here. Copy any text you need, then reload the saved version before editing again.") : e);
          reload.hidden=e.code !== "context_changed";
        } finally {save.disabled=false;}
      });
      panel.append(el("div",{class:"actions"},save,reload));
      return panel;
    }
    async function conversationPage(id) {
      let response = await api("/v1/conversations/" + encodeURIComponent(id) + "?limit=20"), c = response.conversation;
      const error = errorBox(), messages = el("div", {}, response.messages.map(messageNode)), requests = response.requests || [], actions = el("div", { class: "actions" }), history2 = el("section", { class: "reading" }, messages), more = btn("Load more history", async () => {
        more.disabled = true;
        try {
          response = await api("/v1/conversations/" + encodeURIComponent(id) + "?limit=20&after=" + response.next_cursor);
          messages.append(...response.messages.map(messageNode));
          more.hidden = !response.has_more;
        } catch (e) {
          showError(error, e);
        } finally {
          more.disabled = false;
        }
      }, true);
      more.hidden = !response.has_more;
      history2.append(more, error);
      const latest = requests.at(-1);
      const status = c.stopped_at ? "Stopped" : c.limit_reached ? "Turn limit reached" : latest?.status === "completed" && latest.retrieved_at ? "Retrieved" : statusNames[latest?.status] || "Conversation recorded";
      if (!c.stopped_at && c.outstanding_requests) {
        const stop = btn("Stop further work", async () => {
          if (!confirm("Stop further dispatches and invalidate pending claims in this work chain? Work already running inside another provider may continue.")) return;
          stop.disabled = true;
          try {
            await api("/v1/conversations/" + encodeURIComponent(id) + "/stop", { method: "POST", body: {} });
            await fetchOverview();
            await render(false);
          } catch (e) {
            showError(error, e);
          } finally {
            stop.disabled = false;
          }
        }, true);
        actions.append(stop);
      }
      if (c.limit_reached && !c.stopped_at) {
        const extend = btn("Allow 10 more requests", async () => {
          extend.disabled = true;
          try {
            await api("/v1/conversations/" + encodeURIComponent(id) + "/extend", { method: "POST", body: { requests: 10, depth: 0 } });
            toast("The chain can now make ten more requests. Delegation depth is unchanged.");
            await render(false);
          } catch (e) {
            showError(error, e);
          } finally {
            extend.disabled = false;
          }
        }, true);
        actions.append(extend);
      }
      const interactive = requests.filter((j) => ["input_required", "needs_approval"].includes(j.status) || (j.id === latest?.id && j.status === "completed"));
      for (const summary of interactive) {
        const job = (await api("/v1/jobs/" + encodeURIComponent(summary.id) + "?full=1")).job;
        history2.append(el("section", { class: "form-section" }, el("h2", {}, job.status === "completed" ? "Follow up on this answer" : statusNames[job.status]), el("p", {}, job.result?.question || job.title), requestControls(job, error)));
      }
      return [back("#/activity", "Activity"), head(c.title, c.participants.map(who).join(" · ")), el("div", { class: "reading" }, el("div", { class: "status-summary" }, el("h3", {}, status), el("p", {}, c.stopped_at ? "Hitchhike will not dispatch more work for this chain. Already-running provider work may need to be stopped in that app." : latest?.status === "completed" && !latest.retrieved_at ? "The answer is ready. The originating assistant has not acknowledged retrieval." : c.outstanding_requests + " outstanding " + (c.outstanding_requests === 1 ? "request" : "requests") + ". " + c.requests_used + " of " + c.request_limit + " requests used."), actions), sharedContext(c), history2, foot(c.expires_at ? "History expires " + date(c.expires_at) + ", " + c.retention_days + " days after the last message." : "The entire history is preserved while a request remains outstanding."))];
    }
    function requestControls(job, error) {
      const area = el("textarea", { rows: "4", placeholder: job.status === "input_required" ? "Your answer…" : "Specific revision feedback…", maxlength: "20000" }), actions = el("div", { class: "actions" }), wrapper = el("div", {});
      async function transition(action, text, button) {
        button.disabled = true;
        try {
          await api("/v1/jobs/" + encodeURIComponent(job.id) + "/" + action, { method: "POST", body: text ? { text } : {} });
          await fetchOverview();
          toast(action === "accept" ? "Result acknowledged." : action === "reply" ? "Your answer is ready for the assistant." : "Request updated.");
          await render(false);
        } catch (e) {
          showError(error, e);
        } finally {
          button.disabled = false;
        }
      }
      if (job.status === "input_required") {
        wrapper.append(field("Your answer", area));
        const answer = btn("Send clarification", () => {
          if (!area.value.trim()) {
            showError(error, new Error("Write an answer first."));
            area.focus();
            return;
          }
          transition("reply", area.value, answer);
        });
        actions.append(answer);
      }
      if (job.status === "needs_approval") {
        const approve = btn("Approve request", () => transition("approve", null, approve));
        actions.append(approve);
      }
      if (job.status === "completed" && !job.retrieved_at && job.from === "owner") {
        const accept = btn("Acknowledge result", () => transition("accept", null, accept));
        actions.append(accept);
      }
      if (job.status === "completed") {
        const revision = el("details", {}, el("summary", {}, "Request a revision"), field("Specific revision feedback", area));
        const revise = btn("Send revision feedback", () => {
          if (!area.value.trim()) {
            showError(error, new Error("Describe the revision you need."));
            return;
          }
          transition("reject", area.value, revise);
        }, true);
        revision.append(revise);
        wrapper.append(revision);
      }
      if (OPEN.has(job.status)) {
        const cancel = btn("Stop request", () => {
          if (confirm("Stop this request? Work already running inside the provider may continue.")) transition("cancel", null, cancel);
        }, true);
        actions.append(cancel);
      }
      wrapper.append(actions);
      return wrapper;
    }
    async function legacyJobPage(id) {
      const result = await api("/v1/jobs/" + encodeURIComponent(id) + "?full=1"), j = result.job, error = errorBox(), children = [back("#/activity", "Activity"), head(j.title, who(j.from) + " → " + who(j.to))], body = el("div", { class: "reading" });
      body.append(el("div", { class: "status-summary" }, el("h3", {}, j.status === "completed" && j.retrieved_at ? "Retrieved" : statusNames[j.status] || j.status), el("p", {}, "Requested " + date(j.created_at) + ". " + (j.completed_at ? "Answered " + date(j.completed_at) + ". " : "") + (j.retrieved_at ? "Retrieved " + date(j.retrieved_at) + "." : ""))), el("article", { class: "message" }, el("div", { class: "message-head" }, el("strong", {}, who(j.from))), el("div", { class: "message-body" }, j.goal)), (j.thread || []).map((m) => el("article", { class: "message" }, el("div", { class: "message-head" }, el("strong", {}, who(m.from) + " · " + m.kind), el("time", {}, date(m.at))), el("div", { class: "message-body" }, m.text))));
      if (j.result) body.append(el("article", { class: "message" }, el("div", { class: "message-head" }, el("strong", {}, who(j.result.worker))), el("div", { class: "message-body" }, j.result.body || j.result.summary || j.result.question || j.result.error)));
      if (j.error) body.append(note("This request did not finish", j.error, null, "error"));
      body.append(requestControls(j, error), error);
      children.push(body);
      return children;
    }
    function safeUrl(value) {
      try {
        const u = new URL(value);
        return u.protocol === "https:" && !u.username && !u.password;
      } catch {
        return false;
      }
    }
    function field(label, input, help) {
      const id = input.id || "field-" + crypto.randomUUID();
      input.id = id;
      return el("div", { class: "form-group" }, el("label", { for: id }, label), input, help && el("p", {}, help));
    }
    function check(label, input, description) {
      return el("label", { class: "check-row" }, input, el("span", {}, el("strong", {}, label), description && el("small", {}, description)));
    }
    async function settingsPage() {
      const settings = await api("/v1/admin/workspace"), w = settings.workspace, usage = settings.usage || {}, limits = settings.limits || {}, error = errorBox(), paused = el("input", { type: "checkbox", checked: w.paused }), form = el("form", {});
      // The legacy self-hosted workspace uses INT_MAX as an unbounded sentinel.
      // Keep actual hosted/configured quotas (including zero) visible.
      const usageLabel = (key, label) => String(usage[key] ?? 0) + (limits[key] != null && (HOSTED || limits[key] !== 2147483647) ? " of " + String(limits[key]) : "") + " " + label;
      const save = btn("Save preferences", async () => {
        save.disabled = true;
        try {
          await api("/v1/admin/workspace", { method: "PATCH", body: { paused: paused.checked } });
          toast("Workspace preferences saved.");
          dirty = false;
          await render(false);
        } catch (e) {
          showError(error, e);
        } finally {
          save.disabled = false;
        }
      });
      const email = HOSTED && typeof session?.user?.email === "string" ? session.user.email : "";
      form.append(el("section", { class: "form-section first" }, el("h2", {}, "Account"), el("p", {}, email ? "Signed in as " + email + "." : HOSTED ? "Signed in." : "Opened with your owner key."), btn("Sign out", signOutNow, true)), el("section", { class: "form-section" }, el("h2", {}, "Conversation history"), el("p", {}, "Completed conversations are preserved together for 30 days after their last message. History with outstanding requests is not removed. Older task records may follow your existing retention setting."), el("p", { class: "muted small" }, "Current task retention: " + w.retention_days + " days.")), el("section", { class: "form-section" }, el("h2", {}, "Workspace activity"), el("p", {}, "Pause intake and updates in this workspace. Existing history stays available. Work already running in a provider may continue."), check("Pause workspace activity", paused)), error, el("div", { class: "actions" }, save), el("section", { class: "form-section" }, el("h2", {}, "Workspace usage"), el("p", {}, usageLabel("connections", "connections") + ". " + usageLabel("jobs_month", "work requests this month") + "."), el("p", { class: "small muted" }, "Replies, clarifications, polling, and transport retries are not additional work requests.")));
      const resources = settings.resources?.workspace;
      const formatCount = (n) => Number(n || 0).toLocaleString();
      form.append(el("p", { class: "small muted" }, formatCount(usage.jobs_day) + " of " + formatCount(limits.jobs_day) + " work requests today · " + formatCount(usage.open_jobs) + " of " + formatCount(limits.open_jobs) + " outstanding."), el("p", { class: "small muted" }, (Number(usage.storage_bytes || 0) / 1048576).toFixed(1) + " of " + (Number(limits.storage_bytes || 0) / 1048576).toFixed(0) + " MiB storage allowance, including history and connection records."));
      if (resources) {
        form.append(el("section", { class: "form-section" }, el("h2", {}, "Fair-use allowance"), el("p", {}, formatCount(resources.month.used) + " of " + formatCount(resources.month.limit) + " resource units this month. " + formatCount(resources.day.used) + " of " + formatCount(resources.day.limit) + " today."), el("p", { class: "small muted" }, "Checks, replies and retries use resource units; larger operations use more. These are separate from your work-request allowance. The last 10% is reserved for collecting results, finishing work, and recovery."), el("p", { class: "small muted" }, "Daily allowance resets " + date(resources.day.resets_at) + ". Monthly allowance resets " + date(resources.month.resets_at) + ".")));
        if (resources.day.near_limit || resources.month.near_limit) form.append(note("Approaching your fair-use allowance", "Slow down idle checks to leave room for useful exchanges. Existing answers remain subject to the reserved recovery allowance.", null, "warning"));
      }
      if (settings.resources?.new_work_paused) form.append(note("New work is temporarily paused", "You can still collect existing answers and stop requests while recovery capacity remains available.", null, "warning"));
      const exportButton = btn("Export workspace", async () => {
        exportButton.disabled = true;
        try {
          const out = await api("/v1/admin/export"), url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })), link = el("a", { href: url, download: "hitchhike-export.json" });
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1e3);
          toast("Export downloaded. Credentials are excluded.");
        } catch (e) {
          showError(error, e);
        } finally {
          exportButton.disabled = false;
        }
      }, true);
      form.append(el("section", { class: "form-section" }, el("h2", {}, "Your data"), el("p", {}, "Download your conversations, task results, and connection settings. Credentials are excluded."), exportButton), el("section", { class: "form-section" }, el("h2", {}, "Earlier workspace"), el("p", {}, "The earlier Hitchhike interface is still available."), btn("Open earlier workspace", HOSTED ? "/app?experience=legacy" : "/?experience=legacy", true)));
      form.addEventListener("input", () => dirty = true);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        save.click();
      });
      return el("div", { class: "wide" }, head("Settings", "A few preferences for your private workspace."), el("div", { class: "reading" }, form));
    }
    async function activationPanel(id, allowSetup = true) {
      const out = await api("/v1/agents/" + encodeURIComponent(id) + "/activation"), current = out?.activation === void 0 ? out : out.activation;
      if (!allowSetup && !current?.configured) return null;
      const error = errorBox(), panel = el("details", {}, el("summary", {}, allowSetup ? "Claude Code routine adapter" : "Existing routine adapter"), el("p", {}, allowSetup ? "Use the API-triggered routine URL and scoped token from Claude. Saving never fires the routine. Enabling allows later queued work to request new cloud sessions." : "This connection has a saved routine adapter from an earlier setup. You can stop future launches and remove its saved token here."));
      if (current?.configured) panel.append(note(current.enabled ? "Routine adapter enabled" : "Routine adapter configured", "Routine " + current.routine_hint + ". " + (current.latest_dispatch ? "Latest launch: " + current.latest_dispatch.status + ". " : "") + "A launch is not proof of completed work."));
      if (allowSetup) {
      const routineGuide = await getGuide(id, "cloud").catch(e => { if (e.code === "auth") throw e; return {}; });
      if (routineGuide.routinePrompt) panel.append(el("p", {}, "Save these instructions in the Claude routine itself before enabling its API trigger."), copybox("Claude routine instructions", routineGuide.routinePrompt));
      const endpoint = el("input", { type: "url", autocomplete: "off", placeholder: "https://api.anthropic.com/v1/…/trig_…/fire" }), secret = el("input", { type: "password", autocomplete: "new-password" }), enabled = el("input", { type: "checkbox", checked: false });
      panel.append(field("Routine API URL", endpoint), field("Scoped routine token", secret, "Stored encrypted on the relay. It will not be displayed again."), check("Enable this adapter for future requests", enabled));
      const save = btn("Save routine connection", async () => {
        if (!endpoint.value.trim() || !secret.value.trim()) {
          showError(error, new Error("Enter the routine API URL and scoped token before saving this adapter."));
          (!endpoint.value.trim() ? endpoint : secret).focus();
          return;
        }
        if (!endpoint.reportValidity()) return;
        save.disabled = true;
        try {
          await api("/v1/agents/" + encodeURIComponent(id) + "/activation", { method: "PUT", body: { endpoint: endpoint.value.trim(), token: secret.value.trim(), enabled: enabled.checked } });
          secret.value = "";
          endpoint.value = "";
          toast("Routine adapter saved. No session was launched.");
          await render(false);
        } catch (e) {
          showError(error, e);
        } finally {
          save.disabled = false;
        }
      }, true);
      panel.append(save);
      }
      panel.append(error);
      if (current?.configured) {
        const remove = btn("Disable and remove saved routine credentials", async () => {
          if (!confirm("Remove this relay’s saved routine token and stop future launches? Revoke the token in Claude separately.")) return;
          remove.disabled = true;
          try {
            await api("/v1/agents/" + encodeURIComponent(id) + "/activation", { method: "DELETE", body: {} });
            toast("Saved routine credentials removed.");
            await render(false);
          } catch (e) {
            showError(error, e);
          } finally {
            remove.disabled = false;
          }
        }, true);
        panel.append(el("div", { class: "actions" }, remove));
      }
      return panel;
    }
    async function signOutNow() {
      try {
        if (HOSTED) await api("/auth/logout", { method: "POST", body: {} });
        if (CLERK) {
          const clerk = await window.AgentConnectAuth.ready;
          await clerk.signOut(function() {
          });
        }
      } catch (e) {
        toast(e.message);
      } finally { signOut(); }
    }
    $("#gate-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      token = $("#owner-key").value.trim();
      try {
        memory.set(KEY, token);
        await openWorkspace();
      } catch (error) {
        showError($("#session-error"), error);
      }
    });
    function start() {
      if (heldDrafts) {
        if (heldDrafts.identity === draftIdentity()) {
          for (const [key, value] of heldDrafts.contexts) contextDrafts.set(key, value);
          dirty = contextDrafts.size > 0;
        }
        heldDrafts = null;
        $("#draft-reauth")?.remove();
      }
      signedIn = true;
      syncPollScope();
      if (!lastRefreshAt) lastRefreshAt = Date.now();
      renderAccount();
      $("#gate").hidden = true;
      $("#boot").hidden = true;
      $("#workspace").hidden = false;
      render();
      schedule();
    }
    function clearLegacyDrafts() {
      for (const p of ["dot", "chatgpt", "claude", "claude-code", "codex", "grok-bot", "grok", "muse", "openclaw", "other"]) memory.del("hitchhike:new-connection:" + p);
    }
    async function openWorkspace() {
      clearLegacyDrafts();
      const release = await api("/v1/workspace/release");
      if (release.enabled) {
        await fetchOverview();
        start();
        return;
      }
      $("#gate").hidden = true;
      $("#boot").hidden = false;
      const error = errorBox(), enable = btn("Try the new workspace", async () => {
        enable.disabled = true;
        try {
          await api("/v1/workspace/release", { method: "PUT", body: { enabled: true } });
          await fetchOverview();
          start();
        } catch (e) {
          showError(error, e);
        } finally {
          enable.disabled = false;
        }
      });
      $("#boot").replaceChildren(head("Meet your next workspace", "A calmer way to connect your assistants and keep their conversations together."), el("p", { class: "muted" }, "This keeps your existing connections and data. Connecting an assistant doesn’t wake it."), error, el("div", { class: "actions" }, enable, btn("Keep the earlier workspace", HOSTED ? "/app?experience=legacy" : "/?experience=legacy", true)));
    }
    // Sign-in may carry the assistant someone chose (?assistant=claude). Keep it
    // as the add-assistant route so it survives the sign-in round trip.
    function adoptIntent() {
      const params = new URLSearchParams(location.search), chosen = params.get("assistant");
      if (params.has("assistant")) history.replaceState(null, "", location.pathname + (chosen && /^[a-z][a-z-]{1,23}$/.test(chosen) && LABELS[chosen] ? "#/connect/" + chosen : location.hash));
      const r = parseRoute(), link = $("#gate-sign-in");
      if (link && r.page === "connect" && r.id && LABELS[r.id]) link.setAttribute("href", "/sign-in?return_to=" + encodeURIComponent("/app-next?assistant=" + r.id));
    }
    async function boot() {
      adoptIntent();
      if (HOSTED) {
        memory.del(KEY);
        if (location.hash.startsWith("#token=")) history.replaceState(null, "", location.pathname + location.search);
        try {
          if (CLERK) {
            const clerk = await window.AgentConnectAuth?.ready;
            if (!clerk?.session) {
              expireSession();
              return;
            }
          }
          session = await api("/auth/session");
          if (!session.authenticated) {
            expireSession();
            return;
          }
          csrf = session.csrfToken;
        } catch (e) {
          if (heldDrafts) expireSession(); else signOut(e.message);
          return;
        }
      } else {
        const match = location.hash.match(/^#token=([^&]+)/);
        if (match) {
          try {
            token = decodeURIComponent(match[1]);
            memory.set(KEY, token);
          } catch {
          }
          history.replaceState(null, "", location.pathname + location.search + "#/agents");
        }
        if (!token) {
          signOut();
          return;
        }
      }
      try {
        await openWorkspace();
      } catch (e) {
        if (e.code === "auth") return;
        $("#boot").replaceChildren(head("Your workspace couldn’t load", "Your saved connections are unchanged."), note("Check your connection", e.message, btn("Try again", boot), "error"));
      }
    }
    boot();
  })();
})();
`;
