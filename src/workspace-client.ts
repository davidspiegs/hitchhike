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
    let token = HOSTED ? null : memory.get(KEY), csrf = null, session = null, overview = null, configs = /* @__PURE__ */ new Map(), guides = /* @__PURE__ */ new Map(), pairing = /* @__PURE__ */ new Map();
    const contextDrafts = new Map();
    const instructionDrafts = new Map();
    const instructionSaves = new Map();
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
    function updateRefreshStatus() {
      const text = $("#refresh-status-text"), button = $("#refresh-now");
      if (text) text.textContent = (lastUpdatedAt ? "Status updated " + ago(new Date(lastUpdatedAt).toISOString()) + ". " : "Status is ready. ") + (readPauseUntil > Date.now() ? "Automatic updates paused until " + date(readPauseUntil) + "." : "Next automatic check " + date(automaticDeadline()) + ".");
      if (button) button.disabled = refreshing || readPauseUntil > Date.now();
    }
    function refreshStatus() {
      return el("div", { class: "actions", id: "refresh-status" }, el("span", { class: "small muted", id: "refresh-status-text", role: "status" }), btn("Check now", () => refresh({ manual: true }), true, { id: "refresh-now" }));
    }
    let epoch = 0, routeEpoch = 0, timer = null, signedIn = false, loading = null, refreshing = false, toastTimer = null, dirty = false;
    const OPEN = /* @__PURE__ */ new Set(["queued", "claimed", "input_required", "needs_approval"]);
    const TYPE_LABELS = { task: "General tasks", research: "Research", summarize: "Summaries", monitor: "Monitoring", digest: "Digests", review: "Review and critique", build: "Building and changes" };
    const statusNames = { queued: "Waiting for pickup", claimed: "Picked up", input_required: "Needs clarification", needs_approval: "Needs your approval", completed: "Reply ready", failed: "Failed", canceled: "Stopped", expired: "Expired" };
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
    function icon(kind) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      if (kind === "arrow") svg.setAttribute("class", "chevron");
      const paths = { arrow: "m9 5 7 7-7 7", back: "m14 6-6 6 6 6", plus: "M12 5v14M5 12h14", info: "M12 11v5m0-9v.1", check: "m7 12 3 3 7-7", agent: "M8 4h8M12 2v2M4 8h16v11H4zM8 12h.1M16 12h.1M9 16h6", clock: "M12 7v5l3 2" };
      if (["info", "check", "clock"].includes(kind)) {
        const circle = document.createElementNS(svg.namespaceURI, "circle");
        circle.setAttribute("cx", "12");
        circle.setAttribute("cy", "12");
        circle.setAttribute("r", "9");
        svg.append(circle);
      }
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", paths[kind] || paths.agent);
      svg.append(path);
      return svg;
    }
    function agentIcon(platform) {
      const id = platform === "dot" ? "chatgpt" : platform;
      const ext = { chatgpt: "svg", claude: "svg", muse: "svg", "grok-bot": "svg", codex: "png", "claude-code": "png", grok: "png" }[id];
      const asset = ext && ASSETS["assets/agents/" + id + "." + ext];
      return el("span", { class: "agent-icon " + (platform === "dot" || platform === "chatgpt" ? "dot" : platform.includes("claude") ? "claude" : "code"), "aria-hidden": "true" }, asset ? el("img", { src: asset, alt: "", width: "27", height: "27" }) : icon("agent"));
    }
    function btn(label, action, quiet = false, attrs = {}) {
      return el(typeof action === "string" ? "a" : "button", Object.assign({ class: "btn" + (quiet ? " quiet" : ""), ...typeof action === "string" ? { href: action } : { type: "button", onclick: action } }, attrs), label);
    }
    function head(title, description, action) {
      return el("header", { class: "page-head" }, el("div", {}, el("h1", {}, title), description && el("p", {}, description)), action && el("div", { class: "head-action" }, action));
    }
    function back(href = "#/agents", text = "Your agents") {
      return el("a", { class: "back", href }, icon("back"), text);
    }
    function foot(text) {
      return el("p", { class: "footnote" }, icon("info"), text);
    }
    function note(title, text, action, tone = "") {
      return el("section", { class: "notice " + tone }, icon("info"), el("div", {}, el("h2", {}, title), el("p", {}, text)), action);
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
    async function copy(text, button, container) {
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
        button.textContent = "Copied";
        setTimeout(() => {
          if (button.isConnected) button.textContent = "Copy";
        }, 2e3);
      } catch {
        const disclosure = $("details", container);
        if (disclosure) disclosure.open = true;
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents($("pre", container));
        selection.removeAllRanges();
        selection.addRange(range);
        toast("Copy is unavailable. The text is selected; use your device’s Copy action.");
      }
    }
    function setupCopyLabel(text) {
      const value = text.trim();
      if (/^https?:\/\/\S+$/.test(value)) return "MCP server URL";
      if (/^(?:claude|codex|npx|npm|uvx|curl|python3?|node)(?:\s|$)/.test(value)) return "Setup command";
      return "Copy for your assistant";
    }
    function copybox(label, text, prepare) {
      const box = el("div", { class: "copybox" }), button = btn("Copy", async () => {
        if (prepare) {
          button.disabled = true;
          try { text = await prepare(); content.textContent = text; }
          catch (e) { toast(e.message || "The instructions could not be refreshed. Your draft is kept here."); return; }
          finally { button.disabled = false; }
        }
        await copy(text, button, box);
      }, true);
      const content = el("pre", { tabindex: "0" }, text);
      box.append(el("div", { class: "copytop" }, el("strong", {}, label), button), text.length > 500 ? el("details", {}, el("summary", {}, "Preview instructions"), content) : content);
      return box;
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
        const stale = target || result.agents.filter(a => !configs.has(a.id) || Date.now() - (configFetchedAt.get(a.id) || 0) >= CONFIG_MAX_AGE).sort((a, b) => (configFetchedAt.get(a.id) || 0) - (configFetchedAt.get(b.id) || 0))[0];
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
      $("#network-error").textContent = error.retryAt ? "Workspace status updates are paused until " + date(error.retryAt) + ". Your saved progress is safe." : error.message + " Your saved progress is safe. Use Check now to retry, or wait for the next automatic check.";
      updateRefreshStatus();
    }
    function draftIdentity() {
      if (HOSTED) return session?.user?.id && session?.workspace?.id ? JSON.stringify([session.user.id, session.workspace.id]) : null;
      return token ? JSON.stringify([token, overview?.workspace?.id || "selfhost"]) : null;
    }
    function expireSession() {
      const identity = draftIdentity();
      if (identity && (instructionDrafts.size || contextDrafts.size)) heldDrafts = { identity, instructions: new Map([...instructionDrafts].map(([key, value]) => [key, { ...value }])), contexts: new Map(contextDrafts) };
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
      instructionDrafts.clear();
      instructionSaves.clear();
      memory.del(KEY);
      dirty = false;
      main.replaceChildren();
      $("#boot").replaceChildren();
      if ($("#owner-key")) $("#owner-key").value = "";
      $("#workspace").hidden = true;
      $("#boot").hidden = true;
      $("#gate").hidden = false;
      $("#session-error").hidden = !message;
      $("#session-error").textContent = message;
    }
    async function refresh(options = {}) {
      if (refreshing || !signedIn || document.hidden) return;
      syncPollScope();
      const now = Date.now(), generation = epoch;
      pollRounds = pollRounds.filter(at => at > now - POLL_WINDOW);
      if (readPauseUntil > now || (!options.manual && pollRounds.length >= POLL_ROUNDS)) { schedule(); return; }
      if (options.manual && lastRefreshAt > 0 && now - lastRefreshAt < 60e3) { toast("Status was checked less than a minute ago. You can check again in a moment."); return; }
      if (!options.manual) pollRounds.push(now);
      lastRefreshAt = now;
      clearTimeout(timer);
      clearTimeout(focusTimer);
      refreshing = true;
      updateRefreshStatus();
      try {
        await fetchOverview();
        if (generation !== epoch) return;
        const route2 = parseRoute();
        if (route2.page === "activity" || (route2.page === "agents" && !route2.id)) await render(false);
        else if (route2.page === "setup") updateSetupEvidence(route2.id);
      } catch (e) {
        if (generation === epoch) network(e);
      } finally {
        if (generation === epoch) {
          refreshing = false;
          if (!options.manual) pollStep = Math.min(pollStep + 1, POLL_DELAYS.length - 1);
          nextPollAt = Date.now() + POLL_DELAYS[pollStep];
          schedule();
        }
      }
    }
    function schedule() {
      clearTimeout(timer);
      if (!signedIn) return;
      if (!nextPollAt) nextPollAt = Date.now() + POLL_DELAYS[pollStep];
      updateRefreshStatus();
      if (!document.hidden && !refreshing) timer = setTimeout(() => refresh(), Math.max(1, automaticDeadline() - Date.now()));
    }
    function foregroundRefresh() {
      clearTimeout(focusTimer);
      if (!signedIn || document.hidden) { clearTimeout(timer); return; }
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
    async function render(focus = true) {
      if (!signedIn || !overview) return;
      const generation = ++routeEpoch;
      const r = parseRoute();
      dirty = contextDrafts.size > 0 || instructionDrafts.size > 0;
      $("#agents-nav").setAttribute("aria-current", ["activity", "conversations", "jobs"].includes(r.page) ? "false" : "page");
      $("#activity-nav").setAttribute("aria-current", ["activity", "conversations", "jobs"].includes(r.page) ? "page" : "false");
      main.replaceChildren(skeleton());
      try {
        let content;
        if (r.page === "connect") content = connectPage(r.id);
        else if (r.page === "setup") content = await setupPage(r.id, r.step);
        else if (r.page === "agents" && r.id) content = await configurationPage(r.id);
        else if (r.page === "activity") content = await activityPage();
        else if (r.page === "conversations") content = await conversationPage(r.id);
        else if (r.page === "jobs") content = await legacyJobPage(r.id);
        else if (r.page === "settings") content = await settingsPage();
        else content = agentsPage();
        if (r.page === "activity" || (r.page === "agents" && !r.id)) {
          const pendingDraft = overview.agents.find(agent => instructionDrafts.has(instructionKey(agent.id)));
          if (pendingDraft) content.splice(1, 0, el("p", { class: "small muted draft-reminder" }, "Unsaved instructions are kept in this tab. ", el("a", { href: "#/setup/" + encodeURIComponent(pendingDraft.id) + "/instructions" }, "Return to " + pendingDraft.name + "’s draft.")));
        }
        if (generation !== routeEpoch) return;
        content = [content].flat();
        if (!["setup", "connect"].includes(r.page)) content.splice(Math.max(0, content.findIndex(node => node?.tagName === "HEADER") + 1), 0, refreshStatus());
        main.replaceChildren(...[content].flat().filter((node) => node !== null && node !== undefined && node !== false));
        // Detached controls report no layout height; measure after mounting even
        // when navigating between pages does not change the observed width.
        resizeInstructionPreviews();
        if (focus) {
          window.scrollTo(0, 0);
          main.focus({ preventScroll: true });
        }
        document.title = (main.querySelector("h1")?.textContent || "Your agents") + " · Hitchhike";
      } catch (e) {
        if (generation !== routeEpoch || e.code === "auth") return;
        if (e.status === 429) network(e);
        main.replaceChildren(back(), head("This page couldn’t load", "Your saved progress is still here."), refreshStatus(), note("Try again", e.message, btn("Reload page", () => render()), "error"));
      }
      schedule();
    }
    window.addEventListener("hashchange", () => render());
    function growInstructionPrompt(preview, prompt) {
      if (preview.tagName === "DETAILS" && !preview.open) return;
      prompt.style.height = "auto";
      const border = Math.max(0, (prompt.offsetHeight || 0) - (prompt.clientHeight || 0));
      prompt.style.height = Math.max(160, prompt.scrollHeight + border) + "px";
    }
    function resizeInstructionPreviews() {
      $$(".instruction-preview", main).forEach(preview => {
        const prompt = $("textarea", preview);
        if (prompt) growInstructionPrompt(preview, prompt);
      });
    }
    window.addEventListener("resize", resizeInstructionPreviews);
    if (typeof ResizeObserver !== "undefined") {
      let instructionWidth = 0;
      new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width;
        if (width !== instructionWidth) { instructionWidth = width; resizeInstructionPreviews(); }
      }).observe(main);
    }
    window.addEventListener("beforeunload", (e) => {
      if (dirty || heldDrafts) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    function readiness(a) {
      const c = configs.get(a.id);
      if (!c) return { text: a.last_seen_at ? "Access observed" : "Waiting for contact", tone: a.last_seen_at ? "" : "pending", detail: "Readiness not loaded" };
      if (c.readiness.peer_collaboration?.verified) return { text: "Exchange verified", tone: "good", detail: c.readiness.background.verified ? "Background verified" : "Background not verified" };
      if (c.onboarding.step === "done") return { text: "Set up", tone: "", detail: "No recent peer exchange on record" };
      if (c.readiness.access.verified) return { text: "Access confirmed", tone: "", detail: "No peer exchange observed yet" };
      return { text: "Waiting for contact", tone: "pending", detail: "Waiting for first contact" };
    }
    function agentsPage() {
      const agents = overview.agents, children = [head("Your agents", "Good help, already in your corner. Connect your assistants and let them work together.", btn([icon("plus"), "Connect an agent"], "#/connect"))];
      if (!agents.length) {
        children.push(el("section", { class: "empty-state" }, el("h2", {}, "Start with the assistant you talk to most."), el("p", {}, "Then add someone it can turn to. Hitchhike carries the context and replies between them, so you don’t have to."), btn("Connect your first agent", "#/connect"), foot("A connection doesn’t wake an assistant. We’ll help you check access, complete an exchange, and understand its background options.")));
        return children;
      }
      const pending = agents.find((a) => {
        const c = configs.get(a.id);
        return c && !["exchange", "done"].includes(c.onboarding.step) && !setupReady(c);
      });
      if (pending) {
        const c = configs.get(pending.id);
        children.push(note("Continue connecting " + pending.name, "Your saved connection instructions are ready when you are.", btn("Continue setup", "#/setup/" + encodeURIComponent(pending.id) + "/" + (c.onboarding.step === "choose" ? "connect" : c.onboarding.step), true)));
      }
      const failures = overview.jobs.filter((j) => j.status === "failed" && Date.now() - Date.parse(j.updated_at) < 864e5);
      if (failures.length) children.push(note("An exchange needs attention", "Open Activity to see what happened and how to recover.", btn("View activity", "#/activity", true), "error"));
      children.push(el("div", { class: "section-heading" }, el("h2", {}, "Connected assistants"), el("span", { class: "small muted" }, agents.length + " " + (agents.length === 1 ? "connection" : "connections"))), el("div", { class: "agent-list" }, agents.map((a) => {
        const c = configs.get(a.id), r = readiness(a);
        return el("a", { class: "agent-row", href: "#/agents/" + encodeURIComponent(a.id) }, agentIcon(a.platform), el("div", {}, el("div", { class: "agent-name" }, a.name), el("p", {}, a.platform_label + (c?.settings.purpose ? " · " + c.settings.purpose.slice(0, 110) : " · " + (a.can_work ? "Send and receive work" : "Send work")))), el("div", { class: "agent-status" }, state(r.text, r.tone), el("p", {}, r.detail)), icon("arrow"));
      })), foot("Your agents work in their own apps. Hitchhike keeps the handoffs and replies together."));
      return children;
    }
    const SURFACES = { dot: [["dots", "Dots"]], chatgpt: [["chat", "ChatGPT · Experimental"], ["dots", "Dots"]], claude: [["chat", "Claude chat"]], codex: [["desktop", "Codex desktop"], ["terminal", "Codex CLI"], ["cloud", "Codex cloud"]], "claude-code": [["terminal", "Claude Code terminal"], ["desktop", "Claude Code desktop"], ["cloud", "Claude Code cloud routines"]] };
    function uniqueHandle(name) {
      let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 26);
      if (!/^[a-z]/.test(base) || base.length < 2 || ["owner", "relay", "all", "any", "admin", "me"].includes(base)) base = "agent-" + base;
      let value = base, n = 2;
      while (overview.agents.some((a) => a.handle === value || a.id === value)) value = base + "-" + n++;
      return value;
    }
    function connectPage(platformId) {
      const p = overview.platforms.find((x) => x.id === platformId);
      if (!p) return el("div", { class: "provider-picker" }, back(), head("Who’s coming along?", "Connect the assistants you already use. Each one brings its own tools and intelligence."), el("div", { class: "provider-list" }, overview.platforms.map((p2) => el("a", { class: "provider-option", href: "#/connect/" + encodeURIComponent(p2.id) }, agentIcon(p2.id), el("span", { class: "provider-copy" }, el("strong", {}, p2.label), el("span", { class: "muted" }, p2.blurb)), icon("arrow")))), foot("Have a ChatGPT connection already? Dots can use that same connection."));
      const shared = ["dot", "chatgpt"].includes(p.id) ? overview.agents.filter((a) => ["dot", "chatgpt"].includes(a.platform)) : [];
      if (shared.length) return [back("#/connect", "Choose an assistant"), head("Use the connection you already have", "ChatGPT and Dots may share one authorization. Reusing it avoids changing the connection underneath your other conversations."), el("div", { class: "agent-list" }, shared.map((a) => el("a", { class: "agent-row", href: "#/setup/" + encodeURIComponent(a.id) + "/connect" }, agentIcon(a.platform), el("div", {}, el("strong", {}, a.name), el("p", {}, a.platform_label)), state(readiness(a).text), icon("arrow")))), foot("A separate name would not establish independent routing. The access check confirms the authorized identity before any work is sent.")];
      const savedKey = "hitchhike:new-connection:" + (session?.workspace?.id || "selfhost") + ":" + p.id, prior = memory.get(savedKey);
      let attempt = null;
      try {
        attempt = prior ? JSON.parse(prior) : null;
      } catch {
      }
      const names = el("input", { id: "agent-name", value: attempt?.name || p.label.replace(" (OpenAI)", ""), required: true, maxlength: 80, autocomplete: "off" });
      const surfaceOptions = SURFACES[p.id] || [[["grok-bot", "grok", "muse"].includes(p.id) ? "chat" : "terminal", p.label]];
      const surface = el("select", { id: "agent-surface" }, surfaceOptions.map(([id, label]) => el("option", { value: id, selected: id === attempt?.surface }, label)));
      const error = errorBox(), submit = btn("Get connection instructions", save), form = el("form", { onsubmit: (e) => {
        e.preventDefault();
        save();
      } }, surfaceOptions.length > 1 ? el("div", { class: "form-group" }, el("label", { for: "agent-surface" }, "Where do you use " + p.label + "?"), surface, el("p", {}, "We’ll show the instructions for this surface.")) : null, el("div", { class: "form-group" }, el("label", { for: "agent-name" }, "What would you like to call it?"), names, el("p", {}, "A familiar name helps you recognize it later.")), el("div", { class: "status-summary" }, el("h3", {}, "Start with useful defaults"), el("p", {}, "Use this connection to ask for help and receive work. Share relevant supplied context only. You can refine permissions and collaborators afterward.")), error, el("div", { class: "actions" }, submit));
      if (attempt) form.prepend(note("Resume your previous attempt", "We’ll recover the same connection if it was already created."));
      let busy = false, saved = null;
      async function save() {
        if (busy) return;
        if (!names.reportValidity()) return;
        busy = true;
        submit.disabled = true;
        error.hidden = true;
        const generation = epoch;
        if (!attempt) {
          attempt = { id: uniqueHandle(names.value.trim()), name: names.value.trim(), surface: surface.value };
          memory.set(savedKey, JSON.stringify(attempt));
        }
        try {
          let existing = overview.agents.find((a) => a.handle === attempt.id || a.id === attempt.id);
          let out = saved || (existing ? { agent: existing } : await api("/v1/admin/agents", { method: "POST", body: { id: attempt.id, name: attempt.name, platform: p.id, ...p.defaults, can_request: true, can_work: true } }));
          saved = out;
          if (generation !== epoch) return;
          if (out.guide) guides.set(out.agent.id, out.guide);
          if (out.pairing) pairing.set(out.agent.id, { expires_at: out.pairing.expires_at, guide: out.guide });
          await api("/v1/agents/" + encodeURIComponent(out.agent.id) + "/onboarding", { method: "PATCH", body: { provider: p.id, surface: attempt.surface, step: "connect" } });
          await fetchOverview();
          memory.del(savedKey);
          route("#/setup/" + encodeURIComponent(out.agent.id) + "/connect");
        } catch (e) {
          if (e.code === "handle_taken") {
            await fetchOverview().catch(() => {
            });
            showError(error, new Error("This connection may already have been saved. Continue once more to reopen its setup."));
          } else showError(error, e);
        } finally {
          busy = false;
          submit.disabled = false;
        }
      }
      return [back("#/connect", "Choose an assistant"), head("Make room for " + p.label, surfaceOptions.length > 1 ? "Choose where you use it. We’ll take you through the rest." : "Give your connection a name. We’ll take you through the rest."), el("div", { class: "reading" }, form)];
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
            pairing.delete(id);
          }
          configs.set(id, value); configFetchedAt.set(id, Date.now());
        }
        return value;
      });
      configRequests.set(id, request);
      try { return await request; } finally { if (configRequests.get(id) === request) configRequests.delete(id); }
    }
    async function getGuide(id, surface, background, force = false) {
      const draft = instructionDrafts.get(instructionKey(id));
      background ||= draft?.backgroundEdited ? draft.background : null;
      const preview = background ? "&background_enabled=" + background.enabled + (background.enabled ? "&background_interval=" + background.interval_minutes : "") : "";
      const a = overview?.agents.find(agent => agent.id === id);
      const version = JSON.stringify([configs.get(id)?.version ?? 0, configs.get(id)?.release?.enabled, a?.name, a?.platform, a?.can_request, a?.can_work, a?.work_types, a?.poll_minutes]);
      const key = id + ":" + surface + ":" + version + preview;
      if (!force && guides.has(key)) return guides.get(key);
      const generation = epoch;
      const response = await api("/v1/admin/agents/" + encodeURIComponent(id) + "/setup?surface=" + encodeURIComponent(surface || "") + preview);
      if (generation !== epoch) throw Object.assign(new Error("Your session changed. Reopen connection setup."), { code: "auth" });
      if (response.guide) guides.set(key, response.guide);
      return response.guide;
    }
    async function saveStep(id, step, surface, provider) {
      const current = configs.get(id);
      if (current?.onboarding.step === "done" && !["connect", "done"].includes(step) && !surface && !provider) return current;
      const out = await api("/v1/agents/" + encodeURIComponent(id) + "/onboarding", { method: "PATCH", body: { step, ...surface ? { surface } : {}, ...provider ? { provider } : {} } });
      configs.set(id, out);
      if (surface || provider) for (const key of guides.keys()) if (key === id || key.startsWith(id + ":")) guides.delete(key);
      return out;
    }
    const PROFILE_CHOICES = [
      { id: "judgment", label: "Use your judgment", description: "If helpful, you may involve your connected assistants. You decide whether to ask and which assistant fits the work." },
      { id: "available", label: "Be available to help", description: "Help my other assistants when they ask, using the permissions and context I’ve given you." },
      { id: "delegate", label: "Delegate work", description: "Ask capable peers to handle suitable parts, then check and combine their work." },
      { id: "offload", label: "Offload routine work", description: "Hand off a clear task, avoid duplicate work, and keep track of the result." },
      { id: "collaborate", label: "Work as a team", description: "Exchange questions and work within your saved responsibilities and permissions." },
      { id: "second_opinion", label: "Get a second opinion", description: "Ask for critique or an independent check, then decide what to use." }
    ];
    function instructionSelection(settings) {
      const value = settings?.instructions;
      return { profile: PROFILE_CHOICES.some(p => p.id === value?.profile) ? value.profile : "judgment", custom_prompt: typeof value?.custom_prompt === "string" ? value.custom_prompt : null };
    }
    function sameInstructions(a, b) { return a?.profile === b?.profile && a?.custom_prompt === b?.custom_prompt; }
    function instructionKey(id) { return (session?.workspace?.id || overview?.workspace?.id || "selfhost") + ":" + id; }
    function forgetInstructionDraft(id) {
      const key = instructionKey(id), flight = instructionSaves.get(key);
      if (flight) flight.discarded = true;
      instructionDrafts.delete(key); instructionSaves.delete(key);
    }
    function instructionEditor(a, c, g, options = {}) {
      const key = instructionKey(a.id);
      const makeProfiles = guide => PROFILE_CHOICES.map(choice => {
        const supplied = guide.instructionProfiles?.find(profile => profile.id === choice.id);
        return { ...choice, ...supplied, prompt: supplied?.prompt || choice.description + "\n\n" + (guide.collaborationPrompt || guide.prompts?.[0]?.copy || "Follow the saved connection permissions and refresh your instructions before starting work.") };
      });
      let profiles = makeProfiles(g);
      const sameBackground = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
      const resolvedBackground = current => current.settings.setup_background ?? (g.backgroundSelection ? { enabled: g.backgroundSelection.enabled, interval_minutes: g.backgroundSelection.intervalMinutes } : null);
      let saved = instructionSelection(c.settings), savedBackground = resolvedBackground(c), draft = instructionDrafts.get(key) || { ...saved, background: savedBackground, baseBackground: c.settings.setup_background ?? null, version: c.version, base: saved }, busy = false, previewing = false, pendingReplacement = null;
      draft.background ??= savedBackground;
      const rebase = current => { if (current?.version > draft.version && sameInstructions(instructionSelection(current.settings), draft.base) && sameBackground(current.settings.setup_background, draft.baseBackground)) draft.version = current.version; };
      rebase(c);
      const error = errorBox(), stateLabel = el("span", { class: "instruction-state", role: "status", "aria-live": "polite" }), summary = el("p", { class: "muted small" });
      const prompt = el("textarea", { id: "collaboration-prompt", rows: "8", maxlength: "16000", spellcheck: "false", "aria-describedby": "instruction-authority" });
      const preview = options.paired ? el("details", { class: "instruction-preview" }, el("summary", {}, "Personal wording (optional)"), field("Saved instructions", prompt)) : el("div", { class: "instruction-preview" }, field("Introduction", prompt));
      const controls = [];
      const choices = el("fieldset", { class: "instruction-profiles" }, el("legend", {}, "How should this assistant work with others?"));
      const moreSummary = el("summary", {}, "More starting points"), moreChoices = el("details", { class: "instruction-more" }, moreSummary);
      const scheduleText = () => g.backgroundSchedulePrompt || "";
      const withoutSchedule = text => scheduleText() && text.endsWith("\n\n" + scheduleText()) ? text.slice(0, -(scheduleText().length + 2)) : text;
      const generated = () => withoutSchedule(profiles.find(profile => profile.id === draft.profile).prompt);
      const combined = () => [prompt.value, scheduleText() && !prompt.value.endsWith(scheduleText()) ? scheduleText() : ""].filter(Boolean).join("\n\n");
      const scheduleCopy = el("p", { class: "intro-schedule small" });
      const scheduleSection = el("div", { class: "intro-background" }, el("strong", {}, "Background request · included when copying"), scheduleCopy);
      const changed = () => {
        const latest = configs.get(a.id), baseline = latest?.version > c.version ? instructionSelection(latest.settings) : saved;
        return instructionSaves.has(key) || draft.profile !== baseline.profile || draft.custom_prompt !== baseline.custom_prompt || !sameBackground(draft.background, latest?.version > c.version ? resolvedBackground(latest) : savedBackground);
      };
      const copyLabel = () => changed() ? "Copy draft" : "Copy";
      const remember = () => { draft = { ...draft }; if (changed() || instructionSaves.has(key)) instructionDrafts.set(key, draft); else instructionDrafts.delete(key); dirty = contextDrafts.size > 0 || instructionDrafts.size > 0; if (changed()) options.onChange?.(); };
      const grow = () => growInstructionPrompt(preview, prompt);
      const update = () => {
        controls.forEach(({ input, row, profile }) => { input.checked = profile.id === draft.profile; row.className = "instruction-choice" + (input.checked ? " selected" : ""); });
        prompt.value = draft.custom_prompt ?? generated();
        scheduleCopy.textContent = scheduleText(); scheduleCopy.hidden = !scheduleText(); scheduleSection.hidden = !scheduleText();
        summary.textContent = profiles.find(profile => profile.id === draft.profile).description;
        moreSummary.textContent = "More starting points" + (["judgment", "available"].includes(draft.profile) ? "" : " · " + profiles.find(profile => profile.id === draft.profile).label + " selected");
        stateLabel.textContent = changed() ? "Unsaved changes" : "Saved";
        stateLabel.className = "instruction-state" + (changed() ? " unsaved" : "");
        copyButton.textContent = copyLabel();
        reset.hidden = draft.custom_prompt === null;
        saveRow.hidden = !changed();
        grow();
      };
      const replacementText = el("p", { id: "instruction-replacement-label" });
      const replacementWarning = "Choose whether to keep your text or use the selected starter before saving.";
      const clearReplacement = () => { pendingReplacement = null; replacement.hidden = true; if (error.textContent === replacementWarning) error.hidden = true; };
      const keepText = btn("Keep my text", () => { if (busy) return; clearReplacement(); update(); controls.find(({ profile }) => profile.id === draft.profile).input.focus(); }, true);
      const useStarter = btn("Use selected starter", () => { if (busy || !pendingReplacement) return; draft.profile = pendingReplacement; draft.custom_prompt = null; clearReplacement(); remember(); update(); controls.find(({ profile }) => profile.id === draft.profile).input.focus(); });
      const replacement = el("div", { class: "instruction-replacement", role: "group", "aria-labelledby": "instruction-replacement-label", hidden: true }, replacementText, el("div", { class: "actions" }, keepText, useStarter));
      const askReplacement = profile => {
        if (busy) return;
        pendingReplacement = profile.id;
        replacementText.textContent = "Use the “" + profile.label + "” starter? Your current text stays here until you choose.";
        replacement.hidden = false; update(); keepText.focus();
      };
      profiles.forEach(profile => {
        const input = el("input", { type: "radio", name: "instruction-profile", value: profile.id, checked: profile.id === draft.profile });
        const row = el("label", { class: "instruction-choice" }, input, el("span", {}, el("strong", {}, profile.label, profile.id === "judgment" ? el("span", { class: "recommended" }, "Recommended") : null), el("small", {}, profile.description)));
        input.addEventListener("change", () => {
          if (busy || profile.id === draft.profile) return;
          if (draft.custom_prompt !== null) { askReplacement(profile); return; }
          clearReplacement();
          draft.profile = profile.id; draft.custom_prompt = null; remember(); update();
        });
        controls.push({ input, row, profile }); (PROFILE_CHOICES.slice(0, 2).some(choice => choice.id === profile.id) ? choices : moreChoices).append(row);
      });
      choices.append(moreChoices);
      prompt.addEventListener("input", () => { if (busy) return; draft.custom_prompt = prompt.value === generated() ? null : prompt.value; remember(); stateLabel.textContent = changed() ? "Unsaved changes" : "Saved"; stateLabel.className = "instruction-state" + (changed() ? " unsaved" : ""); copyButton.textContent = copyLabel(); reset.hidden = draft.custom_prompt === null; saveRow.hidden = !changed(); grow(); });
      preview.addEventListener("toggle", grow);
      const copyButton = btn("Copy", async () => {
        try { if (previewing) return; await navigator.clipboard.writeText(combined()); copyButton.textContent = "Copied"; toast(changed() ? "Draft copied. Save it here to keep these instructions." : "Instructions copied. Paste them into your assistant; copying does not install them."); setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = copyLabel(); }, 2000); }
        catch { preview.open = true; grow(); const manual = el("textarea", { class: "manual-introduction", rows: "8", readonly: true, "aria-label": "Complete introduction for manual copying" }); manual.value = combined(); preview.append(manual); manual.focus(); manual.select(); toast("Select and copy this complete introduction using your device’s Copy action."); }
      }, true);
      const reset = btn("Reset to generated instructions", () => askReplacement(profiles.find(profile => profile.id === draft.profile)), true);
      preview.append(reset);
      const reload = btn("Reload saved instructions", async () => { if (!confirm("Discard this draft and reload the saved instructions? Copy any text you want to keep first.")) return; instructionDrafts.delete(key); dirty = contextDrafts.size > 0 || instructionDrafts.size > 0; await render(false); }, true, { hidden: true });
      const saveButton = btn("Save instructions", () => save().catch(() => {}), !options.paired);
      async function save() {
        if (busy || previewing || instructionSaves.has(key)) { const pendingError = new Error("These instructions are still saving. Your newer edits are kept; save them when that finishes."); showError(error, pendingError); throw pendingError; }
        if (pendingReplacement) { const choiceError = new Error(replacementWarning); showError(error, choiceError); throw choiceError; }
        if (!prompt.reportValidity()) throw new Error("Instructions must be at most 16,000 characters.");
        rebase(configs.get(a.id));
        busy = true; saveButton.disabled = true; error.hidden = true;
        controls.forEach(({ input }) => input.disabled = true); prompt.disabled = true; reset.disabled = true; reload.disabled = true;
        const submitted = { profile: draft.profile, custom_prompt: draft.custom_prompt }, submittedBackground = draft.background;
        const submittedDraft = draft, generation = epoch, flight = {};
        if (!instructionDrafts.has(key)) instructionDrafts.set(key, submittedDraft);
        dirty = true;
        instructionSaves.set(key, flight);
        try {
          const out = await api("/v1/agents/" + encodeURIComponent(a.id) + "/collaboration", { method: "PUT", body: { expected_version: draft.version, instructions: submitted, ...(submittedBackground ? { setup_background: submittedBackground } : {}) } });
          if (generation !== epoch || flight.discarded) throw new Error("Your session or connection changed. Return to your agents before continuing.");
          if (!configs.has(a.id) || configs.get(a.id).version <= out.version) configs.set(a.id, out);
          saved = submitted; savedBackground = submittedBackground;
          if (submittedDraft.version <= out.version) { submittedDraft.version = out.version; submittedDraft.base = submitted; submittedDraft.baseBackground = submittedBackground; }
          const current = instructionDrafts.get(key);
          if (current && current !== submittedDraft) { if (current.version <= out.version) { current.version = out.version; current.base = submitted; current.baseBackground = submittedBackground; } }
          else instructionDrafts.delete(key);
          draft = instructionDrafts.get(key) || { ...saved, background: savedBackground, baseBackground: savedBackground, version: out.version, base: saved };
          if (instructionSaves.get(key) === flight) instructionSaves.delete(key);
          for (const cacheKey of guides.keys()) if (cacheKey === a.id || cacheKey.startsWith(a.id + ":")) guides.delete(cacheKey);
          dirty = contextDrafts.size > 0 || instructionDrafts.size > 0; reload.hidden = true; update(); toast(options.paired ? "Preferences saved. Your assistant loads them from Hitchhike." : "Instructions saved. Copy them into your assistant to apply them there.");
          return out;
        } catch (e) {
          if (generation === epoch && !flight.discarded) { if (!instructionDrafts.has(key)) instructionDrafts.set(key, draft); dirty = true; reload.hidden = e.status !== 409; showError(error, e.status === 409 ? new Error("Instructions changed elsewhere. Your draft is kept here. Copy any text you need, then reload the saved version before saving again.") : e); }
          throw e;
        } finally { if (instructionSaves.get(key) === flight) instructionSaves.delete(key); busy = false; saveButton.disabled = false; controls.forEach(({ input }) => input.disabled = false); prompt.disabled = false; reset.disabled = false; reload.disabled = false; }
      }
      let backgroundControl = null;
      if (draft.background) {
        const enabled = el("input", { id: "setup-background-enabled", type: "checkbox", checked: draft.background.enabled });
        const minimum = ["claude", "grok", "chatgpt"].includes(a.platform) && c.onboarding.surface !== "dots" ? 60 : 5;
        const interval = el("input", { id: "setup-background-interval", type: "number", min: String(minimum), max: "10080", value: draft.background.interval_minutes || (minimum === 60 ? 60 : 10) });
        const intervalField = field("Check every (minutes)", interval, "Your assistant will report the cadence its provider supports.");
        intervalField.hidden = !enabled.checked;
        const previewBackground = async () => {
          if (busy || previewing) return;
          const minutes = Number(interval.value);
          if (enabled.checked && (!Number.isSafeInteger(minutes) || minutes < minimum || minutes > 10080)) { showError(error, new Error("Choose a whole number from " + minimum + " to 10080 minutes.")); return; }
          const previous = draft.background;
          draft.background = { enabled: enabled.checked, interval_minutes: enabled.checked ? minutes : null };
          draft.backgroundEdited = true; intervalField.hidden = !enabled.checked;
          remember(); options.onChange?.(); previewing = true; copyButton.disabled = true; saveButton.disabled = true; enabled.disabled = true; interval.disabled = true; error.hidden = true;
          try { g = await getGuide(a.id, c.onboarding.surface, draft.background); profiles = makeProfiles(g); update(); options.onGuide?.(g); }
          catch (e) { draft.background = previous; enabled.checked = previous.enabled; interval.value = previous.interval_minutes || minimum; intervalField.hidden = !enabled.checked; remember(); update(); showError(error, e); }
          finally { previewing = false; copyButton.disabled = false; saveButton.disabled = false; enabled.disabled = false; interval.disabled = false; }
        };
        enabled.addEventListener("change", previewBackground); interval.addEventListener("change", previewBackground);
        backgroundControl = el("details", { class: "background-choice background-disclosure" }, el("summary", {}, "Background checking"),
          check("Ask for a recurring check", enabled, "The introduction asks your assistant to create a supported schedule. Saving or copying here does not create one."), intervalField);
      }
      const preferences = el("details", { class: "working-preferences" }, el("summary", {}, "Working preferences (optional)"), choices, replacement, el("p", { id: "instruction-authority", class: "small muted" }, "These preferences do not change permissions or assign a permanent role."));
      const saveRow = el("div", { class: "instruction-save-row" }, stateLabel, saveButton);
      const node = el("section", { class: "instruction-editor" }, options.paired ? el("div", { class: "saved-preferences" }, choices, replacement, preview, el("p", { id: "instruction-authority", class: "small muted" }, "These preferences do not change permissions or assign a permanent role.")) : el("div", { class: "copybox instruction-copy" }, el("div", { class: "copytop" }, el("strong", {}, "Give this to " + a.name), copyButton), preview, scheduleSection), options.paired ? null : preferences, backgroundControl, saveRow, error, reload);
      update();
      return { node, save, changed, needsSave: () => changed() || (!!draft.background && !(configs.get(a.id) || c).settings.setup_background) };
    }
    function backgroundGuideSection(a, c, g) {
      const guide = g.backgroundGuide;
      return el("section", { class: "background-guide" }, el("h3", {}, guide?.title || "Background setup"), el("p", {}, guide?.summary || "Create a supported provider schedule separately, then check actual runs. A saved method or copied prompt does not prove background execution."),
        el("p", { class: "small muted" }, c.readiness?.background?.verified ? "Verified " + c.readiness.background.observed_runs + " completed and retrieved background runs." : "Background execution is optional and has not been verified."),
        guide?.where ? el("p", { class: "guide-destination" }, el("strong", {}, "Where this goes: "), guide.where) : null,
        guide?.intervalLabel ? el("p", { class: "small muted" }, guide.intervalLabel) : null,
        guide?.runPrompt ? copybox("Task instructions — for manual schedule setup", guide.runPrompt) : guide?.setupPrompt ? copybox("Background instructions", guide.setupPrompt) : null,
        !guide && g.backgroundPrompt ? copybox("Provider background guidance", g.backgroundPrompt) : null,
        guide?.recovery?.length ? el("details", {}, el("summary", {}, "Background setup help"), el("ul", { class: "plain-list" }, guide.recovery.map(item => el("li", {}, item)))) : null,
        foot("Expected pickup depends on the configured interval and provider delay. Verify authenticated calls and the returned result in the original conversation."));
    }
    function peerExchange(a, c) {
      const testCategories = ["task", "research", "summarize", "monitor", "digest", "review"];
      const peers = (c.roster || []).filter(peer => peer.id !== a.id && peer.last_seen_at && peer.work_categories?.some(type => testCategories.includes(type))), section = el("section", { class: "peer-exchange form-section" }, el("h2", {}, "Try an assistant-to-assistant exchange"));
      if (!a.can_request || !peers.length) {
        section.append(el("p", {}, !a.can_request ? "This connection cannot send requests. Enable sending deliberately in its preferences, or begin the exchange from an assistant permitted to send work here." : "No contacted collaborator is eligible for this harmless test. Open another connected assistant to confirm access, then check that its permissions include a category such as General tasks. Build-only connections need a separately authorized task."), btn(!a.can_request ? "Review sending permissions" : "Review your agents", !a.can_request ? "#/agents/" + encodeURIComponent(a.id) : "#/agents", true));
        return section;
      }
      const select = el("select", { id: "peer-test-recipient" }, peers.map(peer => el("option", { value: peer.id }, peer.name + " · " + peer.id))), slot = el("div", {}), testKeys = new Map();
      const draw = () => {
        const peer = peers.find(item => item.id === select.value), category = testCategories.find(type => peer.work_categories.includes(type)), stable = "hitchhike-" + a.id + "-interactive";
        if (!testKeys.has(peer.id)) testKeys.set(peer.id, "peer-check-" + crypto.randomUUID());
        const idempotency = testKeys.get(peer.id), http = a.connects === "routine", beta = c.release?.enabled === true;
        const task = "Return HITCHHIKE-PEER-CHECK and one sentence acknowledging this test. Do not browse, access private files, or change other services.";
        const common = "Run one harmless assistant-to-assistant Hitchhike test from this conversation. Confirm " + (http ? "GET /v1/me" : "connection_status") + " identifies you as " + a.name + " (" + a.id + "). Use only this connection’s current permissions. The recipient is " + peer.name + " (" + peer.id + "), work category " + category + ". Ask it to " + task.charAt(0).toLowerCase() + task.slice(1) + "\n\n";
        let protocol;
        if (http) {
          const sendBody = beta ? { to: peer.id, type: category, message: task, response_requested: true } : { to: peer.id, type: category, title: "Hitchhike peer check", goal: task };
          protocol = "Use authenticated HTTP at " + new URL(API || location.origin, location.origin).origin + " with this connection’s privately stored bearer credential. Keep Authorization headers on this relay origin only; use Accept: application/json and Content-Type: application/json for JSON bodies. First GET /v1/me and confirm effective sending permission. "
            + (beta ? "Then GET /v1/configuration and verify the exact recipient and type are still present in its eligible roster. " : "This release uses the legacy API. Use the exact approved recipient and type above; do not assume a configuration or roster endpoint exists. ")
            + "Send POST " + (beta ? "/v1/conversations" : "/v1/jobs") + " with Idempotency-Key: " + idempotency + " and JSON " + JSON.stringify(sendBody) + ". Reuse this exact key and body only for retries of this pasted test; never issue a second test because a response was delayed. "
            + (beta ? "Retain the returned request.id and conversation.id. The recipient must claim and reply using its own credential and current claim; do not impersonate it. If it is on demand, ask me to open it and check for work once. Retrieve the reply in THIS originating conversation: GET /v1/conversations/inbox?consumer_id=" + encodeURIComponent(stable) + "&limit=3; read GET /v1/conversations/:id?after=0&limit=20 using the retained conversation ID, following has_more with after=next_cursor. After reading each page, POST /v1/conversations/:id/acknowledge with only JSON {\"consumer_id\":" + JSON.stringify(stable) + ",\"cursor\":<that page’s next_cursor>}, replacing the cursor placeholder with the actual returned number. Reuse this exact stable delivery consumer ID for subsequent checks and acknowledgments. It is separate from a fresh execution ID used to claim work."
              : "Retain the returned job.id. The recipient must claim and submit using its own credential and claim; do not impersonate it. If it is on demand, ask me to open it and check once. Retrieve GET /v1/jobs/:id?full=1 with that job ID, then GET /v1/inbox?limit=3. Read and report each inbox page before POST /v1/inbox/ack with only JSON {\"delivery_cursor\":<that page’s delivery_cursor>}, replacing the placeholder with the actual returned number. Continue pages while has_more using GET /v1/inbox?cursor=<next_cursor>&limit=3. Legacy acknowledgments are shared; use one designated reader and do not invent consumer_id arguments.");
        } else {
          protocol = beta ? "Refresh get_collaboration_config, verify the recipient and type are still eligible, then use send_message with to=" + JSON.stringify(peer.id) + ", type=" + JSON.stringify(category) + ", message=" + JSON.stringify(task) + ", response_requested=true and idempotency_key=" + JSON.stringify(idempotency) + ". Reuse that exact key and body only for retries of this pasted test. Retain the returned request.id and conversation.id. The recipient must claim and reply under its own current claim; do not impersonate it. If it is on demand, ask me to open it and check for work once. Retrieve the reply in THIS originating conversation using check_conversation_inbox with limit=3 and stable consumer_id " + stable + ", read all relevant get_conversation pages, and call acknowledge_conversation with conversation_id set to the returned conversation.id, that same consumer_id, and cursor set to the page’s next_cursor only after reading. Keep the same delivery consumer ID on future checks; each execution claim uses a fresh execution ID." : "Use the available legacy send_job tool with to=" + JSON.stringify(peer.id) + ", type=" + JSON.stringify(category) + ", title=\"Hitchhike peer check\", task=" + JSON.stringify(task) + " and idempotency_key=" + JSON.stringify(idempotency) + ". Reuse that exact key and body only for retries of this pasted test. Retain its job ID. The recipient must use its own get_next_job and submit_result flow; do not impersonate it. If it is on demand, ask me to open it and check once. Retrieve the reply here with check_inbox (limit: 3) and get_job, then acknowledge_results using the delivery_cursor returned by check_inbox. Do not assume newer conversation tools exist.";
        }
        slot.replaceChildren(copybox("Copy into " + a.name + "’s original conversation", common + protocol + "\n\nReport the exact connection and recipient IDs, request/job ID, conversation ID if provided, and observed sent, answered, and retrieved timestamps. Stop after this one exchange. Do not create acknowledgment messages or a schedule. If a tool is denied, unavailable, or rate-limited, report that and stop; honor Retry-After."));
      };
      select.addEventListener("change", draw); draw();
      section.append(el("p", {}, "Ask this assistant to send a small task to an eligible peer and retrieve the reply here. Copying these instructions does not send anything."), field("Receiving assistant", select), slot);
      return section;
    }
    function setupReady(c) { return !!(c?.readiness?.access?.verified && c?.readiness?.peer_collaboration?.verified); }
    function milestone(title, description, done) {
      return el("div", { class: "milestone" }, icon(done ? "check" : "clock"), el("div", {}, el("strong", {}, title), el("p", {}, description)));
    }
    function setupStatusSummary(id) {
      const r = configs.get(id)?.readiness;
      const contacted = r?.access?.verified, exchanged = r?.peer_collaboration?.verified;
      return el("div", { class: "setup-status-summary", id: "setup-status-summary", role: "status" },
        el("strong", {}, exchanged ? "Your assistants have exchanged work" : contacted ? "Connection contacted" : "Waiting for your assistant"),
        el("p", {}, exchanged ? "An answer was returned and retrieved. You can keep working in your assistants." : contacted ? "Hitchhike has heard from this connection. Exchanges will appear in Activity." : "This updates when your assistant connects. You can finish setup now and return to your conversation."),
        el("p", { class: "small muted" }, r?.background?.verified ? "Background checks verified." : "Background checks are not verified yet."));
    }
    function evidence(id) {
      const c = configs.get(id);
      if (!c) return el("div", {});
      const r = c.readiness;
      return el("div", { class: "readiness", id: "setup-evidence" },
        milestone("Connection access", r.access.verified ? "Authenticated contact " + ago(r.access.last_seen_at) + "." : "Waiting for the assistant to make its first authenticated request.", r.access.verified),
        milestone("Assistants working together", r.peer_collaboration?.verified ? "A request between two distinct connections was answered and retrieved. This verifies the connections, not which individual app or Dot used them." : "No completed and retrieved peer exchange yet. This will update when your assistants work together.", r.peer_collaboration?.verified));
    }
    function updateSetupEvidence(id) {
      const old = $("#setup-evidence");
      if (old && configs.has(id)) old.replaceWith(evidence(id));
      const slot = $("#test-status");
      if (slot) slot.replaceChildren(testStatus(id));
      const summary = $("#setup-status-summary");
      if (summary) summary.replaceWith(setupStatusSummary(id));
    }
    function testJob(id) {
      return overview.jobs.find((j) => j.to === id && j.inputs?.connection_test);
    }
    function testVerified(j) {
      return !!(j?.status === "completed" && j.result?.validation?.ok && j.inputs?.expected_response && (j.result.summary === j.inputs.expected_response || (j.result.body || "").trim() === j.inputs.expected_response));
    }
    function testStatus(id) {
      const j = testJob(id);
      if (!j) return el("p", { class: "muted small" }, "The test asks for a short marker. It does not browse, access files, or change other services.");
      if (testVerified(j)) return note("The expected answer came back", "The agent picked up the test and returned the requested marker. Review and acknowledge it to complete retrieval.", btn("Review result", "#/jobs/" + encodeURIComponent(j.id), true), "success");
      if (j.status === "completed") return note("Review the returned answer", "An answer arrived, but it did not match the expected marker. Check the full result before retrying.", btn("Review result", "#/jobs/" + encodeURIComponent(j.id), true));
      if (OPEN.has(j.status)) return note(statusNames[j.status] || j.status, "The test is queued or running. Ask an on-demand assistant to check once. A connection does not wake it.", btn("View test", "#/jobs/" + encodeURIComponent(j.id), true));
      return note("The test did not finish", j.error || "Check access in your assistant, then send a new test.", btn("Review test", "#/jobs/" + encodeURIComponent(j.id), true), "error");
    }
    async function setupPage(id, requestedStep) {
      const a = overview.agents.find((x) => x.id === id);
      if (!a) throw new Error("This connection no longer exists. Choose another from Your agents.");
      const c = await configuration(id, true), paired = a.connects === "routine", flow = ["connect", "exchange"];
      const step = ["done", "access", "instructions", "exchange", "ready"].includes(requestedStep) ? "exchange" : "connect";
      const index = flow.indexOf(step), g = await getGuide(id, c.onboarding.surface), surface = g.surfaces?.find((x) => x.id === c.onboarding.surface) || g.surfaces?.find((x) => x.id === g.surface), content = el("div", { class: "setup-content" }), error = errorBox();
      const labels = { connect: "Connect", exchange: "Ready" };
      const title = step === "connect" ? "Connect " + a.name : "Ready when you are";
      let editor = null, refreshPairing = () => {};
      if (step === "connect") {
        const options = g.surfaces || [];
        if (options.length > 1) {
          const select = el("select", { id: "setup-surface" }, options.map((s) => el("option", { value: s.id, selected: s.id === c.onboarding.surface }, s.label)));
          content.append(el("div", { class: "form-group" }, el("label", { for: "setup-surface" }, "Your assistant’s surface"), select));
          select.addEventListener("change", async () => {
            try {
              await saveStep(id, step, select.value);
              await render(false);
            } catch (e) {
              showError(error, e);
            }
          });
        }
        const prerequisites = surface?.prerequisites || g.prerequisites || [];
        if (prerequisites.length) {
          content.append(note("Before you switch apps", prerequisites[0]));
          if (prerequisites.length > 1) content.append(el("details", {}, el("summary", {}, "Account requirements and connection identity"), el("ul", {class:"plain-list"}, prerequisites.slice(1).map((text) => el("li", {}, text)))));
        }
        if (paired) {
          editor = instructionEditor(a, c, g, { paired: true, onChange: () => { pairing.delete(id); refreshPairing(); }, onGuide: guide => refreshPairing(guide) });
          content.append(el("p", {}, "Your assistant loads its saved preferences when it connects and refreshes its configuration. You do not need to paste a second working-instruction prompt."), el("details", { class: "pairing-preferences", open: requestedStep === "instructions" }, el("summary", {}, "Preferences (optional)"), editor.node));
        }
        if (paired && HOSTED) {
          const slot = el("div", {});
          const showPairing = () => {
            const pair = pairing.get(id);
            slot.replaceChildren();
            if (pair && Date.parse(pair.expires_at) > Date.now()) {
              const instructions = pair.instructions || pair.guide?.steps?.[0]?.copy;
              slot.append(instructions ? copybox("One-use pairing instructions", instructions) : el("p", {}, "Create fresh instructions below."), el("p", { class: "small muted" }, "Expires " + date(pair.expires_at) + ". Keep this private."));
              setTimeout(() => {
                if (slot.isConnected) showPairing();
              }, Math.min(2147483647, Math.max(1e3, Date.parse(pair.expires_at) - Date.now())));
            } else {
              pairing.delete(id);
              slot.append(el("p", { class: "muted" }, "Create a one-use pairing instruction, then paste it into " + a.name + "."));
              const create = btn("Create pairing instructions", async () => {
                create.disabled = true;
                try {
                  if (editor.needsSave()) await editor.save();
                  const out = await api("/v1/admin/agents/" + encodeURIComponent(id) + "/pairing", { method: "POST", body: {} });
                  pairing.set(id, out);
                  showPairing();
                } catch (e) {
                  showError(error, e);
                } finally {
                  create.disabled = false;
                }
              });
              slot.append(create);
            }
          };
          refreshPairing = showPairing; showPairing();
          content.append(slot);
        }
        if (paired && !HOSTED) {
          const slot = el("div", { class: "selfhost-pairing" });
          let currentGuide = g;
          const pairStep = guide => (guide.surfaces?.find(item => item.id === c.onboarding.surface)?.steps || guide.steps || []).find(item => item.title === "Pair this agent" && item.copy);
          const showPairing = guide => {
            if (guide) currentGuide = guide;
            const instructions = pairStep(currentGuide)?.copy;
            if (!instructions) { slot.replaceChildren(el("p", {}, "Connection instructions are unavailable. Reload this page to try again.")); return; }
            const box = copybox("Private connection instructions", instructions, async () => {
              const generation = epoch, page = routeEpoch;
              await configuration(id, true);
              if (editor.needsSave()) await editor.save();
              const refreshed = await getGuide(id, c.onboarding.surface, null, true);
              if (generation !== epoch || page !== routeEpoch) throw new Error("The page or session changed. Return to setup before copying these instructions.");
              const text = pairStep(refreshed)?.copy;
              if (!text) throw new Error("Connection instructions are unavailable. Reload this page to try again.");
              currentGuide = refreshed;
              return text;
            });
            if (editor.changed()) $("button", box).textContent = "Save and copy";
            slot.replaceChildren(el("p", { class: "small muted" }, "Paste this only into " + a.name + ". It includes the private connection key and loads your saved preferences."), box);
          };
          refreshPairing = showPairing; showPairing(); content.append(slot);
        }
        const selectedSteps = (surface?.steps || g.steps || []).filter(s => !["Confirm access", "Confirm this connection", "Verify in a new cloud run"].includes(s.title) && (!g.accessPrompt || s.copy !== g.accessPrompt) && !(paired && ["Prove the exchange", "Add background checks when ready", "Pair this agent"].includes(s.title)));
        content.append(el("ol", { class: "instructions" }, selectedSteps.map((s) => el("li", {}, el("strong", {}, s.title || "Continue setup"), el("p", {}, s.text), s.copy ? copybox(setupCopyLabel(s.copy), s.copy) : null))));
        const recovery = surface?.recovery || g.recovery || [];
        if (recovery.length) content.append(el("details", {}, el("summary", {}, "Can’t finish this step?"), el("ul", { class: "plain-list" }, recovery.map((t) => el("li", {}, t)))));
        const sources = surface?.sources || g.sources || [];
        if (sources.length) content.append(el("details", {}, el("summary", {}, "Provider instructions"), el("ul", { class: "plain-list" }, sources.filter((s) => safeUrl(s.url)).map((s) => el("li", {}, el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.label))))));
      }
      if (step === "exchange") {
        if (!paired) {
          editor = instructionEditor(a, c, g);
          content.append(el("p", {}, "Paste this introduction into the conversation where you’ll use Hitchhike. Your assistant can take it from there."), editor.node);
        } else content.append(el("p", {}, "Your pairing instructions include the introduction and background preference. Once you’ve pasted them into " + a.name + ", you’re all set here."));
        content.append(setupStatusSummary(id));
        const diagnostics = el("details", { class: "setup-diagnostics" }, el("summary", {}, "Connection details and optional tests"), evidence(id), refreshStatus(), peerExchange(a, c), el("section", { class: "form-section" }, el("h2", {}, "Website-to-agent connection test"), el("p", {}, "This separate marker test checks the connection. It does not prove a peer exchange or background execution."), el("div", { id: "test-status" }, testStatus(id))));
        if (a.can_work) {
          const send = btn("Send website connection test", async () => {
            send.disabled = true;
            try {
              const old = testJob(id);
              if (old && OPEN.has(old.status)) {
                toast("A test is already waiting. Ask your assistant to check for work.");
                return;
              }
              const keyName = "hitchhike:test:" + (session?.workspace?.id || "selfhost") + ":" + id;
              const key = memory.get(keyName) || crypto.randomUUID();
              memory.set(keyName, key);
              await api("/v1/admin/agents/" + encodeURIComponent(id) + "/test", { method: "POST", body: {}, key });
              memory.del(keyName);
              await fetchOverview();
              updateSetupEvidence(id);
              toast("Test queued. Ask your assistant to check for work once.");
            } catch (e) {
              showError(error, e);
            } finally {
              send.disabled = false;
            }
          });
          diagnostics.append(el("div", { class: "actions" }, send));
        } else diagnostics.append(foot("This connection currently sends work only. Enable receiving in its configuration to run an incoming test."));
        diagnostics.append(el("details", {}, el("summary", {}, "Check connection identity"), copybox("Read-only access check", g.accessPrompt || (paired ? "Use authenticated GET /v1/me with your privately stored connection credential." : "Call connection_status.") + " Confirm your authorized connection is " + a.name + " (" + a.id + "). Report its permissions. Do not send or claim work during this check.")));
        content.append(diagnostics);
      }
      content.append(error);
      const actions = el("div", { class: "actions" });
      if (index > 0) actions.append(btn("Back", "#/setup/" + encodeURIComponent(id) + "/" + flow[index - 1], true));
      const last = step === "exchange";
      const next = btn(last ? "Finish setup" : "Continue", async () => {
        const page = routeEpoch;
        next.disabled = true;
        try {
          if (editor?.needsSave()) await editor.save();
          if (page !== routeEpoch) return;
          await saveStep(id, last ? "done" : flow[index + 1]);
          if (page === routeEpoch) route(last ? "#/agents" : "#/setup/" + encodeURIComponent(id) + "/" + flow[index + 1]);
        } catch (e) {
          showError(error, e);
        } finally {
          next.disabled = false;
        }
      }, false, last ? { id: "finish-setup" } : {});
      const leave = btn(last ? "Return to your agents" : "Save and finish later", async () => {
        const page = routeEpoch;
        try { if (editor?.needsSave()) await editor.save(); if (page !== routeEpoch) return; await saveStep(id, step); if (page === routeEpoch) route("#/agents"); }
        catch (e) { showError(error, e); }
      }, true);
      actions.append(...(last ? (c.onboarding.step === "done" ? [leave] : [next, leave]) : [next, leave]));
      content.append(actions);
      const identity = a.platform_label && a.name !== a.platform_label ? a.name + " · " + a.platform_label : a.name;
      return [back(), head(title, [el("span", { class: "setup-identity" }, identity), el("span", { class: "setup-progress-note" }, "Your progress is saved. You can leave and come back at any time.")]), el("div", { class: "setup-layout" }, content, el("ol", { class: "steps", "aria-label": "Setup progress" }, flow.map((s, i) => el("li", { class: i === index ? "current" : "", "aria-current": i === index ? "step" : null }, el("span", { class: "step-count" }, i + 1), labels[s]))))];
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
    function lines(value) {
      return value.split("\n").map((s) => s.trim()).filter(Boolean);
    }
    function categories(label, chosen) {
      const controls = Object.entries(TYPE_LABELS).map(([id, name]) => {
        const input = el("input", { type: "checkbox", value: id, checked: chosen.includes(id) });
        return { input, node: check(name, input) };
      });
      return { node: el("fieldset", { class: "choice-group" }, el("legend", {}, label), controls.map((c) => c.node)), read: () => controls.filter((c) => c.input.checked).map((c) => c.input.value) };
    }
    async function configurationPage(id) {
      const a = overview.agents.find((x) => x.id === id);
      if (!a) throw new Error("This connection is unavailable.");
      const c = await configuration(id, true), s = c.settings, g = await getGuide(id, c.onboarding.surface).catch(e => { if (e.code === "auth") throw e; return {}; }), error = errorBox(), form = el("form", {});
      const codeCloud = a.platform === "claude-code" && c.onboarding.surface === "cloud";
      const backgroundOptions = [["manual", "On demand"], ["scheduled", "Provider schedule"]];
      if (codeCloud) backgroundOptions.push(["claude_routine", "Claude Code routine adapter"]);
      else if (s.background.method === "claude_routine") backgroundOptions.push(["claude_routine", "Keep existing external background setup"]);
      let saving = false;
      const name = el("input", { value: a.name, maxlength: "80", required: true }), purpose = el("textarea", { value: s.purpose, maxlength: "1200", rows: "3" }), initiative = el("input", { type: "checkbox", checked: s.initiative }), responsibilities = el("textarea", { value: s.standing_responsibilities.join("\n"), rows: "4", placeholder: "One responsibility per line" }), all = el("input", { type: "checkbox", checked: s.permitted_collaborators.includes("*") }), peers = overview.agents.filter((x) => x.id !== id).map((peer) => ({ peer, input: el("input", { type: "checkbox", value: peer.id, checked: s.permitted_collaborators.includes("*") || s.permitted_collaborators.includes(peer.id) }) })), request = categories("May request", s.allowed_request_categories), work = categories("May perform", s.allowed_work_categories), sharing = el("textarea", { value: s.sharing.instructions, rows: "4" }), sources = el("textarea", { value: s.sharing.approved_sources.join("\n"), rows: "3", placeholder: "One approved source per line" }), boundaries = el("textarea", { value: s.authorization_boundaries.join("\n"), rows: "3" }), send = el("input", { type: "checkbox", checked: a.can_request }), receive = el("input", { type: "checkbox", checked: a.can_work }), background = el("select", {}, backgroundOptions.map(([value, label]) => el("option", { value, selected: value === s.background.method }, label))), interval = el("input", { type: "number", min: "1", max: "10080", value: s.background.interval_minutes || "", placeholder: "For example, 60" });
      all.addEventListener("change", () => peers.forEach((p) => {
        p.input.disabled = all.checked;
        if (all.checked) p.input.checked = true;
      }));
      peers.forEach((p) => p.input.disabled = all.checked);
      const recipientEditor = el("details", {}, el("summary", {}, "Sharing rules for individual collaborators"), el("p", {}, "These instructions are communicated to the agent. Hitchhike does not classify arbitrary message text."));
      const ruleFields = peers.map(({ peer }) => {
        const rule = s.sharing.recipient_rules.find((r) => r.agent_id === peer.id), instructions = el("textarea", { value: rule?.instructions || "", rows: "3", placeholder: "Specific sharing instructions for " + peer.name }), approved = el("textarea", { value: rule?.approved_sources?.join("\n") || "", rows: "2", placeholder: "Approved sources, one per line" });
        recipientEditor.append(el("div", { class: "collaborator-settings" }, el("h3", {}, peer.name), field("Sharing instructions", instructions), field("Approved sources", approved)));
        return { id: peer.id, instructions, approved };
      });
      form.append(field("Name", name), field("What is " + a.name + " useful for?", purpose, "This helps your other assistants choose whom to ask. It is a description, not verified capability."), el("section", { class: "form-section" }, el("h2", {}, "Working together"), el("p", {}, "Give this assistant room to use good judgment, within your preferences."), check("Use initiative within my responsibilities", initiative, "Request help for the responsibilities below without waiting for a new prompt each time."), field("Standing responsibilities", responsibilities), el("h3", {}, "Available collaborators"), check("All eligible connections", all, "Existing sending and receiving permissions still apply."), peers.map((p) => check(p.peer.name, p.input, p.peer.platform_label)), !peers.length ? foot("Connect another assistant to give this one a collaborator.") : null), el("section", { class: "form-section" }, el("h2", {}, "Work and permissions"), el("p", {}, "Hitchhike enforces these categories and collaborators. Each provider still controls external actions."), check("Send requests", send), check("Receive requests", receive), el("div", { class: "inline-fields" }, request.node, work.node)), el("section", { class: "form-section" }, el("h2", {}, "Sharing and authorization"), el("p", {}, "Share relevant, deliberately supplied context and approved sources. Never automatically forward complete chats or unrelated private material."), field("Sharing instructions", sharing), field("Approved sources", sources, "One source per line. These are instructions for your assistant; a URL does not itself grant access."), recipientEditor, field("Actions requiring further authorization", boundaries, "One instruction per line. These boundaries do not replace the provider’s own permission controls.")), el("section", { class: "form-section" }, el("h2", {}, "Working instructions"), el("p", {}, "Choose when this assistant may ask for help or be available to others. Instructions are saved separately from permissions."), btn("Edit working instructions", "#/setup/" + encodeURIComponent(id) + "/instructions", true)), el("section", { class: "form-section" }, el("h2", {}, "Background behavior"), el("p", {}, "Choose how this assistant should check. Saving a method does not create a provider schedule or prove it runs."), field("Checking method", background), field("Expected interval in minutes", interval, "For scheduled checks. The actual provider must support and run this cadence."), el("details", { class: "background-disclosure" }, el("summary", {}, "Manual schedule setup and observed status"), backgroundGuideSection(a, c, g), evidence(id))), error);
      try {
        const activation = await activationPanel(id, codeCloud);
        if (activation) form.append(activation);
      } catch (e) {
        if (e.code === "auth") throw e;
        form.append(note("Routine settings unavailable", e.message, null, "error"));
      }
      const save = btn("Save preferences", submit);
      form.append(el("div", { class: "actions" }, save, btn("Connection setup", "#/setup/" + encodeURIComponent(id) + "/connect", true)));
      form.addEventListener("input", () => dirty = true);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        submit();
      });
      const reconnect = btn("Replace credentials", async () => {
        if (!confirm("Replace " + a.name + "’s credentials? Current authorizations and keys stop working. You must authorize or pair again.")) return;
        reconnect.disabled = true;
        try {
          const out = await api("/v1/admin/agents", { method: "POST", body: { id, rotate_token: true } });
          for (const key of guides.keys()) if (key === id || key.startsWith(id + ":")) guides.delete(key);
          pairing.delete(id);
          if (out.pairing) pairing.set(id, { expires_at: out.pairing.expires_at, guide: out.guide });
          await saveStep(id, "connect");
          await fetchOverview();
          dirty = false;
          route("#/setup/" + encodeURIComponent(id) + "/connect");
        } catch (e) {
          showError(error, e);
        } finally {
          reconnect.disabled = false;
        }
      }, true);
      const disconnect = btn("Disconnect agent", async () => {
        if (!confirm("Disconnect " + a.name + "? Its authorization stops working and its open requests are canceled. Work already running inside another app may continue.")) return;
        disconnect.disabled = true;
        try {
          await api("/v1/admin/agents/" + encodeURIComponent(id), { method: "DELETE" });
          configs.delete(id);
          forgetInstructionDraft(id);
          pairing.delete(id);
          for (const key of guides.keys()) if (key === id || key.startsWith(id + ":")) guides.delete(key);
          await fetchOverview();
          dirty = false;
          route("#/agents");
        } catch (e) {
          showError(error, e);
        } finally {
          disconnect.disabled = false;
        }
      }, true);
      form.append(el("details", {}, el("summary", {}, "Connection access and recovery"), el("p", {}, "Repeat authorization in the provider when adding a permission. Replace credentials only when you need to revoke the existing authorization. Disconnecting cannot stop work already running in another app."), el("div", { class: "actions" }, reconnect, disconnect)));
      async function submit() {
        if (saving || !form.reportValidity()) return;
        saving = true;
        save.disabled = true;
        error.hidden = true;
        try {
          const changes = {};
          if (name.value.trim() !== a.name) changes.name = name.value.trim();
          if (send.checked !== a.can_request) changes.can_request = send.checked;
          if (receive.checked !== a.can_work) changes.can_work = receive.checked;
          if (JSON.stringify(work.read()) !== JSON.stringify(a.work_types || [])) changes.work_types = work.read();
          if (Object.keys(changes).length) {
            await api("/v1/admin/agents", { method: "POST", body: { id, ...changes } });
            for (const key of guides.keys()) if (key === id || key.startsWith(id + ":")) guides.delete(key);
          }
          const result = await api("/v1/agents/" + encodeURIComponent(id) + "/collaboration", { method: "PUT", body: { expected_version: c.version, purpose: purpose.value, initiative: initiative.checked, standing_responsibilities: lines(responsibilities.value), permitted_collaborators: all.checked ? ["*"] : peers.filter((p) => p.input.checked).map((p) => p.peer.id), allowed_request_categories: request.read(), allowed_work_categories: work.read(), sharing: { instructions: sharing.value, approved_sources: lines(sources.value), recipient_rules: ruleFields.filter((r) => r.instructions.value.trim() || r.approved.value.trim()).map((r) => ({ agent_id: r.id, instructions: r.instructions.value, approved_sources: lines(r.approved.value) })) }, authorization_boundaries: lines(boundaries.value), background: { method: background.value, interval_minutes: background.value === "scheduled" && interval.value ? Number(interval.value) : null } } });
          configs.set(id, result);
          for (const key of guides.keys()) if (key === id || key.startsWith(id + ":")) guides.delete(key);
          dirty = contextDrafts.size > 0 || instructionDrafts.size > 0;
          await fetchOverview();
          toast("Preferences saved. Your agent reads them on its next check. Added provider permissions may need fresh authorization.");
          await render(false);
        } catch (e) {
          showError(error, e);
        } finally {
          saving = false;
          save.disabled = false;
        }
      }
      return [back(), head(a.name, a.platform_label + " · Collaboration preferences", btn("Setup instructions", "#/setup/" + encodeURIComponent(id) + "/connect", true)), el("div", { class: "split" }, form, el("aside", { class: "aside-note" }, el("h3", {}, "Changes travel with the work"), el("p", {}, "Your assistant refreshes these preferences when it starts or continues an exchange."), el("h3", {}, "Connection identity"), el("p", { class: "code-key" }, a.id), ["dot", "chatgpt"].includes(a.platform) ? el("p", {}, "ChatGPT and Dots can share this authorization. A label does not create an independently routable assistant.") : null, el("h3", {}, "Access and permission"), el("p", {}, "Ordinary preference edits preserve authorization. Adding a permission can require reconnecting in the provider.")))];
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
      function rows() {
        section.replaceChildren();
        const shown = conversations.filter((c) => selected === "all" || selected === "open" && c.outstanding_requests > 0 || selected === "attention" && conversationState(c).attention || selected === "done" && c.outstanding_requests === 0);
        for (const c of shown) {
          const status = conversationState(c);
          section.append(el("a", { class: "activity-row", href: "#/conversations/" + encodeURIComponent(c.id) }, el("div", {}, el("strong", {}, c.title), el("p", {}, c.participants.map(who).join(" · "))), el("time", { datetime: c.last_message_at }, ago(c.last_message_at)), state(status.label, status.tone)));
        }
        if (!shown.length) section.append(el("section", { class: "empty-state" }, el("h2", {}, conversations.length ? "Nothing in this view" : "The first handoff starts in your assistant."), el("p", {}, conversations.length ? "Try another activity filter." : "Ask a connected assistant to consult a peer. Their request, questions, and answers will appear here."), btn("Your agents", "#/agents", true)));
      }
      [["all", "All activity"], ["attention", "Needs attention"], ["open", "In progress"], ["done", "Completed"]].forEach(([value, label]) => filters.append(btn(label, () => {
        selected = value;
        $$("button", filters).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === value)));
        rows();
      }, true, { "aria-pressed": value === selected ? "true" : "false", "data-filter": value })));
      rows();
      const legacy = overview.jobs.filter((j) => !j.conversation_id);
      return [head("Activity", "A window into your agents’ work. Your conversations stay in the apps you use."), filters, section, legacy.length ? el("details", {}, el("summary", {}, "Earlier tasks and connection tests"), el("div", {}, legacy.map((j) => el("a", { class: "activity-row", href: "#/jobs/" + encodeURIComponent(j.id) }, el("div", {}, el("strong", {}, j.title), el("p", {}, who(j.from) + " → " + who(j.to))), state(j.status === "completed" && j.retrieved_at ? "Retrieved" : statusNames[j.status] || j.status, j.status === "failed" ? "failed" : ""))))) : null, foot("Waiting means a request is queued. It does not mean the receiving assistant is awake.")];
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
      const reload = btn("Reload saved context", async () => { if (!confirm("Discard this unsaved draft and reload the saved shared context? Copy any text you want to keep first.")) return; contextDrafts.delete(id);dirty=contextDrafts.size>0 || instructionDrafts.size>0;await render(false); }, true, {hidden:true});
      const save = btn("Save shared context", async () => {
        const saveEpoch = epoch;
        save.disabled=true;error.hidden=true;
        try {
          await api("/v1/conversations/"+encodeURIComponent(id)+"/context", {method:"PATCH",body:{pinned_context:text.value,expected_version:expectedVersion}});
          if (saveEpoch !== epoch) return;
          contextDrafts.delete(id);dirty=contextDrafts.size>0 || instructionDrafts.size>0;toast("Shared context saved. The change is recorded in conversation history.");await render(false);
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
      form.append(el("section", { class: "form-section" }, el("h2", {}, "Conversation history"), el("p", {}, "Completed conversations are preserved together for 30 days after their last message. History with outstanding requests is not removed. Older task records may follow your existing retention setting."), el("p", { class: "muted small" }, "Current task retention: " + w.retention_days + " days.")), el("section", { class: "form-section" }, el("h2", {}, "Workspace activity"), el("p", {}, "Pause intake and updates in this workspace. Existing history stays available. Work already running in a provider may continue."), check("Pause workspace activity", paused)), error, el("div", { class: "actions" }, save), el("section", { class: "form-section" }, el("h2", {}, "Workspace usage"), el("p", {}, usageLabel("connections", "connections") + ". " + usageLabel("jobs_month", "work requests this month") + "."), el("p", { class: "small muted" }, "Replies, clarifications, polling, and transport retries are not additional work requests.")));
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
      form.append(el("section", { class: "form-section" }, el("h2", {}, "Your data"), el("p", {}, "Download your conversations, task results, and connection settings. Credentials are excluded."), exportButton), el("section", { class: "form-section" }, el("h2", {}, "Interface beta"), el("p", {}, "This workspace is using the next Hitchhike experience. The earlier interface remains available."), btn("Open earlier workspace", HOSTED ? "/app?experience=legacy" : "/?experience=legacy", true)), el("section", {class:"form-section"}, el("h2", {}, "Account"), btn("Sign out", () => $("#sign-out").click(), true)));
      form.addEventListener("input", () => dirty = true);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        save.click();
      });
      return [head("Workspace settings", "A few preferences for your private workspace."), el("div", { class: "reading" }, form)];
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
    $("#sign-out").addEventListener("click", async () => {
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
    });
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
          for (const [key, value] of heldDrafts.instructions) if (overview.agents.some(agent => instructionKey(agent.id) === key)) instructionDrafts.set(key, value);
          for (const [key, value] of heldDrafts.contexts) contextDrafts.set(key, value);
          dirty = instructionDrafts.size > 0 || contextDrafts.size > 0;
        }
        heldDrafts = null;
        $("#draft-reauth")?.remove();
      }
      signedIn = true;
      syncPollScope();
      if (!lastRefreshAt) lastRefreshAt = Date.now();
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
      $("#boot").replaceChildren(head("Meet your next workspace", "A calmer way to connect your agents and keep their conversations together."), el("p", { class: "muted" }, "This beta keeps your existing connections and data. Live Dots/Claude background routing and physical iPhone Safari verification remain release checks. Connecting an assistant does not wake it."), error, el("div", { class: "actions" }, enable, btn("Keep the earlier workspace", HOSTED ? "/app?experience=legacy" : "/?experience=legacy", true)));
    }
    async function boot() {
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
