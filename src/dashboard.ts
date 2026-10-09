import { clerkBootstrap, type ClerkUiConfig } from "./clerk-ui";
import { PUBLIC_HOME_TITLE, publicPageMetadata } from "./public-pages";

/**
 * The owner's view of the relay: connect agents, send them work, and see what
 * they're doing. Plain HTML with no build step. Everything that comes from
 * agents is rendered with textContent, never as HTML.
 */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const FONTS = "";

const TOKENS = `
:root{
  --paper:#F6F7F8; --panel:#FFFFFF; --ink:#17191B; --muted:#626872; --faint:#69717C; --rule:#E5E7EA; --rule-strong:#CAD0D6;
  --lamp:#F29F16; --lamp-glow:rgba(242,159,22,.55); --lamp-off:#CBD2DA;
  --queued:#596A7B; --approval:#A86200; --working:#1D5FD8; --question:#6E42D0; --done:#137A3E; --failed:#BF3A29; --closed:#5F6B77;
  --focus:#B94316; --btn:#B94316; --btn-ink:#FFFFFF; --accent:#E95C2B;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  --cond:var(--sans);
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  color-scheme: light;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0}
body{background:var(--paper);color:var(--ink);font:400 15px/1.5 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
button,input,textarea,select{font:inherit;color:inherit}
.btn{appearance:none;border:1px solid var(--btn);background:var(--btn);color:var(--btn-ink);border-radius:7px;padding:10px 15px;min-height:42px;font-weight:600;font-size:14px;cursor:pointer;line-height:1.4;white-space:normal;text-align:center}
.btn.quiet{background:transparent;color:var(--ink);border-color:var(--rule-strong)}
.btn.small{padding:7px 11px;min-height:36px;font-size:13px}
.btn:disabled{opacity:.5;cursor:default}
.mono{font-family:var(--mono);font-size:12.5px}
`;

export function dashboardHtml(name: string, options: { hosted?: boolean; authConfigured?: boolean; authProvider?: "google" | "clerk"; clerk?: ClerkUiConfig; nonce?: string; publicLanding?: boolean; apiUrl?: string; signInPath?: string; assets?: Record<string, string> } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${publicPageMetadata("/", options.publicLanding)}
<title>${esc(options.publicLanding ? PUBLIC_HOME_TITLE : name)}</title>
${FONTS}
<style>${TOKENS}${DASHBOARD_CSS}</style>
</head>
<body data-hosted="${options.hosted ? "true" : "false"}" data-auth-configured="${options.authConfigured ? "true" : "false"}" data-auth-provider="${options.authProvider === "clerk" ? "clerk" : "google"}" data-api-url="${esc(options.apiUrl || "")}" data-assets="${esc(JSON.stringify(options.assets || {}))}">
${options.hosted ? `<div id="auth-loading" class="boot-state" role="status" ${options.publicLanding ? "hidden" : ""}>Loading your workspace…</div><noscript><p class="boot-state">Enable JavaScript to use Hitchhike.</p></noscript>` : ""}
<div id="gate" class="gate" ${options.publicLanding ? "" : "hidden"}>
  <form id="gate-form" class="gate-box">
    <h1 class="wordmark">${esc(name)}</h1>
    <p class="lede">Connect your AI apps. Hand off work with context and bring the results back.</p>
    ${options.hosted ? `<p class="hint">Create your private workspace or sign in to continue.</p><a id="hosted-sign-in" class="btn" href="${options.signInPath === "/sign-in" ? "/sign-in?return_to=%2Fapp" : "/auth/start"}" ${options.authConfigured ? "" : "hidden"}>${options.authProvider === "clerk" ? "Create account or sign in" : "Continue with Google"}</a>${options.authConfigured ? "" : `<p class="note">Sign-in is not configured on this deployment yet.</p>`}` : ""}
    <div id="owner-auth" ${options.hosted ? "hidden" : ""}>
    <label class="field"><span>Owner key</span><input id="gate-token" type="password" autocomplete="current-password" required></label>
    <p class="hint">The key set when this relay was deployed, or open your one-click sign-in link. This browser remembers you after the first time.</p>
    <p id="gate-error" class="error" role="alert" hidden></p>
    <button class="btn" type="submit">Sign in</button>
    </div>
    <p id="session-error" class="error" role="alert" hidden></p>
    ${options.hosted ? `<p class="hint"><a href="/privacy">Privacy and data</a> · <a href="/terms">Terms</a></p>` : ""}
  </form>
</div>

<div id="app" class="app" hidden>
  <aside class="side">
    <header class="brand">
      <a class="workspace-brand" href="/" aria-label="${esc(name)} home">${options.assets?.["assets/hitchhike-bus-logo.png"] ? `<span class="brand-crop"><img src="${esc(options.assets["assets/hitchhike-bus-logo.png"])}" alt="${esc(name)}" width="2172" height="724"></span>` : `<span class="wordmark">${esc(name)}</span>`}</a>
      <p class="live"><span id="live-dot" class="live-dot"></span><span id="live-text">Connecting</span></p>
    </header>
    <details class="agents-sec" id="connections-panel" open>
      <summary class="connections-heading"><span id="h-agents">Connections</span><span id="connection-count" class="count"></span></summary>
      <ul id="agents" class="agents"></ul>
      <button id="connect" class="btn quiet add-connection">+ Connect an agent</button>
    </details>
    <section aria-labelledby="h-sched" id="sched-section" hidden>
      <div class="sec-head"><h2 id="h-sched">On a schedule</h2></div>
      <ul id="schedules" class="schedules"></ul>
    </section>
    <footer class="side-foot">
      <button id="help" class="linkish">How it works</button>
      <button id="workspace-settings" class="linkish">Workspace settings</button>
      ${options.hosted ? `<a class="linkish" href="/privacy">Privacy and data</a><a class="linkish" href="/terms">Terms</a>` : ""}
      <button id="copy-link" class="linkish" ${options.hosted ? "hidden" : ""}>Copy sign-in link</button>
      <button id="sign-out" class="linkish">Sign out</button>
    </footer>
  </aside>

  <main class="main">
    <div class="main-head">
      <div><h1 class="workspace-title">Your workspace</h1><p id="summary" class="summary"></p></div>
      <button id="compose" class="btn">Send a task</button>
    </div>
    <section id="start" class="start" aria-labelledby="h-start" hidden>
      <div class="start-head"><span class="eyebrow">Getting connected</span><button id="start-hide" class="linkish">Dismiss</button></div>
      <h2 id="h-start">Connect your first agent</h2>
      <p class="muted" id="start-description"></p>
      <div id="start-action" class="actions"></div>
      <ol id="start-steps" class="start-steps"></ol>
    </section>
    <section id="needs" class="needs" aria-labelledby="h-needs" hidden>
      <h2 id="h-needs">Needs you</h2>
      <ul id="needs-list" class="needs-list"></ul>
    </section>
    <div class="columns">
      <section aria-labelledby="h-jobs" class="jobs-sec">
        <div class="sec-head"><h2 id="h-jobs">Tasks</h2><span id="job-count" class="count"></span></div>
        <div class="task-filters" role="group" aria-label="Filter tasks"><button class="filter-button" data-filter="all" aria-pressed="true">All tasks</button><button class="filter-button" data-filter="open" aria-pressed="false">In progress</button><button class="filter-button" data-filter="results" aria-pressed="false">Results</button></div>
        <ul id="jobs" class="jobs"></ul>
      </section>
      <details class="activity-sec">
        <summary id="h-activity">Recent activity</summary>
        <ol id="activity" class="activity"></ol>
      </details>
    </div>
  </main>
</div>

<aside id="drawer" class="drawer" role="dialog" aria-modal="true" aria-label="Details" tabindex="-1">
  <div class="drawer-bar"><button id="drawer-close" class="btn quiet small">Close</button></div>
  <div id="drawer-body" class="drawer-body"></div>
</aside>
<div id="scrim" class="scrim" hidden></div>
<dialog id="connect-dialog" class="dialog" aria-label="Connect an agent"><div id="connect-body"></div><button id="connect-close" class="dialog-close" type="button" aria-label="Close connection setup">×</button></dialog>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>

${options.hosted && options.authProvider === "clerk" && options.clerk ? clerkBootstrap(options.clerk) : ""}
<script${options.nonce ? ` nonce="${esc(options.nonce)}"` : ""}>${DASHBOARD_JS}</script>
</body>
</html>`;
}

const DASHBOARD_CSS = `
.boot-state{max-width:420px;margin:18vh auto;padding:24px;color:var(--muted);text-align:center}
.gate{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.gate-box{width:100%;max-width:400px;display:grid;gap:14px}
.gate-box p{margin:0}
.lede{color:var(--ink);font-size:16px}
.hint{color:var(--muted);font-size:13.5px}
.wordmark{font:600 25px/1.15 var(--sans);letter-spacing:-.04em;margin:0}
.app{display:grid;grid-template-columns:264px minmax(0,1fr);min-height:100vh;background:var(--panel)}
.side{padding:28px 20px 24px;display:flex;flex-direction:column;gap:36px;background:var(--paper)}
.brand{display:grid;gap:12px}.workspace-brand{display:inline-flex;text-decoration:none;width:fit-content}.brand-crop{position:relative;display:block;width:164px;aspect-ratio:1888 / 411;overflow:hidden}.brand-crop img{position:absolute;width:115.042%;max-width:none;height:auto;left:-7.309%;top:-37.713%}
.live{margin:0;color:var(--muted);font-size:13.5px;display:flex;align-items:center;gap:8px}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--lamp-off)}
.live-dot.on{background:var(--done)}
.sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}
h2{font:650 18px/1.3 var(--sans);letter-spacing:-.02em;margin:0}
.count{color:var(--faint);font-size:13.5px}
.muted{color:var(--muted)}
.agents,.schedules,.jobs,.activity,.needs-list{list-style:none;margin:0;padding:0}
.agent{display:grid;grid-template-columns:30px minmax(0,1fr);gap:2px 10px;align-items:center;padding:12px 8px;margin:0 -8px;border-radius:8px;cursor:pointer}.agent .platform-icon{grid-row:1/4}.agent .agent-name{overflow-wrap:anywhere}.agent .agent-state,.agent .agent-meta{grid-column:2;font-size:12px;text-align:left}.agent .agent-meta{color:var(--faint)}
.agent:hover{background:color-mix(in srgb,var(--ink) 4%,transparent)}
.lamp{width:12px;height:12px;border-radius:50%;background:var(--lamp-off);box-shadow:inset 0 -1px 2px rgba(0,0,0,.18);transition:background .4s,box-shadow .4s;flex:none}
.lamp.lit{background:var(--lamp);box-shadow:0 0 0 3px color-mix(in srgb,var(--lamp) 22%,transparent),0 0 12px var(--lamp-glow)}
.lamp.flash{animation:flash 1.4s ease-out}
.lamp.wait{animation:wait 1.6s ease-in-out infinite}
@keyframes flash{0%{transform:scale(1.5);box-shadow:0 0 0 6px color-mix(in srgb,var(--lamp) 35%,transparent),0 0 22px var(--lamp-glow)}100%{transform:scale(1)}}
@keyframes wait{50%{background:color-mix(in srgb,var(--lamp) 60%,var(--lamp-off))}}
.agent-name{font-weight:600;font-size:14px}
.agent-meta{grid-column:2/4;color:var(--muted);font-size:13.5px}
.agent-state{color:var(--muted);font-size:13px;text-align:right}
.empty{color:var(--muted);font-size:14px;margin:4px 0 0;max-width:52ch}
.schedule{padding:6px 0;font-size:14px;color:var(--muted);border-top:1px solid var(--rule)}
.schedule:first-child{border-top:0}
.schedule b{color:var(--ink);font-weight:500}
.side-foot{margin-top:auto;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.linkish{background:none;border:0;padding:0;color:var(--muted);font-size:13.5px;cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--rule-strong)}
.linkish:hover{color:var(--ink)}
.main{padding:36px clamp(24px,4vw,64px) 56px;min-width:0;width:100%;max-width:1240px}
.main-head{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:36px}.workspace-title{font-size:25px;font-weight:650;letter-spacing:-.035em;line-height:1.2;margin:0 0 8px}.summary{font-size:13px}
.summary{margin:0;color:var(--muted)}
.start{background:color-mix(in srgb,var(--accent) 5%,var(--panel));border-radius:12px;padding:24px;margin-bottom:36px}.eyebrow{font-size:12px;font-weight:600;color:var(--muted)}.start h2{font-size:23px;line-height:1.3;margin-top:16px}.start .actions{margin:18px 0 0}
.start-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.start > .muted{margin:8px 0 0;max-width:64ch;font-size:14px;line-height:1.6}
.start-steps{list-style:none;margin:24px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:12px 24px}
.start-step{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}.start-step.current{color:var(--ink)}.start-step.current .step-num{border-color:var(--accent);color:var(--btn)}
.step-num{width:20px;height:20px;border-radius:50%;border:1px solid var(--rule-strong);display:grid;place-items:center;font:600 11px/1 var(--sans);color:var(--muted)}
.start-step.done .step-num{background:var(--done);border-color:var(--done);color:var(--panel)}
.step-title{font-weight:600}
.start-step.done .step-title{color:var(--muted)}
.step-sub{color:var(--muted);font-size:14px}
.step-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.columns{display:grid;grid-template-columns:minmax(0,1fr);gap:36px;align-items:start}
.needs{margin-bottom:28px;padding:14px 16px;border:1px solid color-mix(in srgb,var(--approval) 45%,var(--rule));border-radius:8px;background:color-mix(in srgb,var(--approval) 6%,var(--panel))}
.needs h2{margin-bottom:8px}
.need{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:8px 0;border-top:1px solid var(--rule)}
.need:first-child{border-top:0}
.need-text{flex:1 1 280px;min-width:0}
.need-actions{display:flex;gap:8px}
.job{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;padding:18px 12px;margin:0 -12px;border-top:1px solid var(--rule);border-radius:5px;cursor:pointer}
.job:first-child{border-top:0}
.job:hover{background:color-mix(in srgb,var(--ink) 3.5%,transparent)}
.job[aria-current="true"]{background:color-mix(in srgb,var(--working) 8%,transparent)}
.job-title{font-weight:600;font-size:14px;overflow-wrap:anywhere}
.job-time{color:var(--faint);font-size:12px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.job-line{grid-column:1/3;display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;color:var(--muted);font-size:12px}
.status{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:var(--s)}
.status::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--s)}
.route{display:inline-flex;align-items:center;gap:5px;color:var(--ink)}
.route-arrow{padding:0 3px;color:var(--muted)}
.activity{display:grid;gap:0;font-size:13px;margin-top:14px}.activity-sec > summary{width:fit-content;cursor:pointer;font-size:13px;font-weight:600;color:var(--muted);padding:8px 0}.activity-sec{max-width:800px}
.event{display:grid;grid-template-columns:58px minmax(0,1fr);gap:10px;padding:7px 0;border-top:1px solid var(--rule)}
.event:first-child{border-top:0}
.event time{color:var(--faint);font-variant-numeric:tabular-nums;font-size:13px;padding-top:1px}
.event .who{font-weight:600}
.event.dim{color:var(--muted)}
.event.fresh{animation:fresh 2.4s ease-out}
@keyframes fresh{from{background:color-mix(in srgb,var(--lamp) 16%,transparent)}to{background:transparent}}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(580px,100%);background:var(--panel);border-left:1px solid var(--rule);transform:translateX(100%);visibility:hidden;transition:transform .22s ease,visibility 0s linear .22s;z-index:20;display:flex;flex-direction:column;box-shadow:-18px 0 40px -28px rgba(0,0,0,.35)}
.drawer.open{transform:none;visibility:visible;transition:transform .22s ease,visibility 0s}
.drawer-bar{display:flex;justify-content:flex-end;padding:12px 16px;border-bottom:1px solid var(--rule)}
.drawer-body{overflow:auto;padding:28px 28px 48px;scrollbar-gutter:stable}
.drawer-body h2{font:650 24px/1.3 var(--sans);letter-spacing:-.03em;margin:0 0 12px}
.drawer-body h3{font:600 15px/1.4 var(--sans);margin:28px 0 10px}
.drawer-body p{margin:0 0 8px;max-width:64ch}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;color:var(--muted);font-size:14px;margin-bottom:12px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 4px}
.prose{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;max-width:70ch}
.pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:10px 12px;border:1px solid var(--rule);border-radius:6px;background:var(--paper);font:12.5px/1.55 var(--mono);max-height:420px;overflow:auto}
.list{margin:0;padding-left:18px}
.list li{margin:3px 0}
.note{margin:10px 0 0;padding:9px 12px;border-left:3px solid var(--rule-strong);color:var(--muted);font-size:14px}
.flagged{border-left-color:var(--approval);color:var(--ink)}
.sources a{overflow-wrap:anywhere;color:var(--working)}
.reply{display:grid;gap:8px;margin-top:10px}
textarea,input[type=text],input[type=password],input[type=number],input[type=url],input:not([type]),select{width:100%;border:1px solid var(--rule-strong);border-radius:6px;background:var(--panel);padding:8px 10px}
textarea{resize:vertical;min-height:96px}
.scrim{position:fixed;inset:0;background:rgba(10,14,18,.28);z-index:10}
.field{display:grid;gap:5px;border:0;padding:0;margin:0 0 16px;min-width:0}
.field > span,.field > legend{font-weight:600;padding:0}
.field small,.help{color:var(--muted);font-size:13.5px}
.check{display:flex;align-items:flex-start;gap:9px;margin:6px 0;cursor:pointer}
.check input{margin-top:4px}
.check b{font-weight:500}
.check small{display:block;color:var(--muted);font-size:13.5px}
.row{display:flex;align-items:center;gap:10px}
.type-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}
@media (max-width:620px){.type-grid{grid-template-columns:minmax(0,1fr)}}
.row select{width:auto}
.dialog{border:1px solid var(--rule);border-radius:14px;padding:28px;width:min(640px,calc(100% - 32px));max-height:calc(100dvh - 40px);background:var(--panel);color:var(--ink);box-shadow:0 18px 80px #17191b24}
.dialog::backdrop{background:rgba(10,14,18,.4)}
.dialog h2{font-size:24px;margin-bottom:6px;padding-right:24px}.dialog-close{position:absolute;right:12px;top:12px;display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:6px;color:var(--muted);background:transparent;font:24px/1 var(--sans);cursor:pointer}.dialog-close:hover{background:var(--paper)}
.dialog p{margin:0 0 16px}
.dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin:0 0 18px}
.tile{display:grid;grid-template-columns:36px minmax(0,1fr);gap:1px 12px;align-items:center;text-align:left;padding:12px;border:1px solid var(--rule);border-radius:8px;background:var(--panel);cursor:pointer}
.tile:hover{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 3%,var(--panel))}
.glyph{grid-row:1/3;width:36px;height:36px;border-radius:8px;background:var(--paper);border:1px solid var(--rule);display:grid;place-items:center;font:600 14px/1 var(--cond);color:var(--ink)}
.tile-name{font-weight:600}
.tile-blurb{font-size:13.5px;color:var(--muted);line-height:1.35}
details.more{margin:20px 0 16px}.result-data{margin-top:20px}
details.more summary{cursor:pointer;color:var(--muted);font-size:14px;margin-bottom:12px}
.guide-steps{list-style:none;margin:18px 0 8px;padding:0;display:grid;gap:18px;counter-reset:g}
.guide-step{display:grid;grid-template-columns:26px minmax(0,1fr);gap:8px 12px}
.guide-step::before{counter-increment:g;content:counter(g);grid-row:1/3;width:24px;height:24px;border-radius:50%;background:var(--ink);color:var(--panel);display:grid;place-items:center;font:600 13px/1 var(--cond)}
.guide-step p{margin:0;font-size:14px;line-height:1.6}.guide-step > :not(:first-child){grid-column:2}
.copybox{position:relative;border:1px solid var(--rule);border-radius:8px;background:var(--paper);min-width:0}
.copybox pre{margin:0;padding:14px 12px 52px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 var(--mono);max-height:260px;overflow:auto}
.copybox .btn{position:absolute;bottom:8px;right:8px;background:var(--panel)}
.setup-prompts{margin-top:24px}.setup-prompts .copybox{display:flex;flex-direction:column;padding:10px;gap:10px}.setup-prompts .copybox .btn{position:static;order:-1;align-self:flex-start}.setup-prompts .copybox pre{padding:4px;max-height:240px}.shared-connections{display:grid;gap:12px;margin:20px 0}.shared-connection{border:1px solid var(--rule);border-radius:8px;padding:14px;min-width:0}.shared-connection p{overflow-wrap:anywhere}.shared-connection .btn{margin-top:8px}
.connect-status{display:flex;align-items:flex-start;gap:10px;padding:16px;border-radius:8px;background:var(--paper);margin:20px 0}.connect-status .lamp{margin-top:4px}
.picks{display:grid;gap:8px;margin:2px 0}
.pick{display:grid;grid-template-columns:18px 12px minmax(0,1fr);gap:2px 10px;align-items:center;padding:10px 12px;border:1px solid var(--rule);border-radius:8px;cursor:pointer}
.pick:has(input:checked){border-color:var(--focus);background:color-mix(in srgb,var(--focus) 6%,var(--panel))}
.pick-name{font-weight:600}
.pick-sub{grid-column:3;font-size:13.5px;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0}
.chip{position:relative;display:inline-flex}
.chip input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
.chip span{display:inline-block;padding:6px 13px;border:1px solid var(--rule-strong);border-radius:999px;font-size:14px}
.chip input:checked + span{background:var(--ink);color:var(--panel);border-color:var(--ink)}
.chip input:focus-visible + span{outline:2px solid var(--focus);outline-offset:2px}
.chip input:disabled + span{opacity:.4}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--panel);padding:10px 16px;border-radius:8px;font-size:14px;max-width:min(560px,calc(100% - 32px));z-index:40;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.usage-list{margin:0}.usage-row{display:flex;justify-content:space-between;gap:20px;padding:8px 0;border-bottom:1px solid var(--rule)}.usage-row dd{margin:0;font-variant-numeric:tabular-nums}.gate-box a.btn{justify-self:start;text-decoration:none}.btn{transition:background .15s,border-color .15s}.agent-meta{overflow-wrap:anywhere}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.event-link{border:0;background:none;padding:0;text-align:left;font:inherit;cursor:pointer}.event-link:hover{text-decoration:underline;text-underline-offset:3px}.error{color:var(--failed);margin:0;font-size:14px}
.warning{color:var(--approval);margin:0 0 12px;font-size:14px}
.sent{padding:14px 16px;border:1px solid color-mix(in srgb,var(--done) 40%,var(--rule));border-radius:8px;background:color-mix(in srgb,var(--done) 6%,var(--panel))}
.sent p{margin:4px 0}
/* Workspace navigation and progressive setup */
.connections-heading{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:650;cursor:pointer;margin-bottom:14px;list-style:none}.connections-heading::-webkit-details-marker{display:none}.connections-heading::after{content:"⌄";font-size:16px;color:var(--muted)}.agents-sec:not([open]) .connections-heading::after{content:"›"}.connection-count{margin-left:auto}.add-connection{margin-top:16px;width:100%;font-size:13px;background:var(--panel)!important}
.platform-icon{display:grid;place-items:center;width:30px;height:30px;flex:none;border-radius:7px;background:#fff;padding:4px}.platform-icon img{width:100%;height:100%;object-fit:contain}.platform-icon.inverse{background:#17191b}.tile .platform-icon{grid-row:1/3;width:36px;height:36px}.platform-group-label{font:600 12px/1.4 var(--sans);color:var(--muted);margin:24px 0 10px}.tile-name{font-size:14px}.tile-blurb{font-size:12px}.connect-heading{display:flex;align-items:center;gap:12px;margin-bottom:16px}.connect-heading h2{margin:0}.setup-heading{display:flex;align-items:center;gap:14px}.setup-heading h2{margin:0}.setup-heading .platform-icon{width:40px;height:40px}.permission-options{gap:8px}.permission-option{padding:12px;border:1px solid var(--rule);border-radius:8px;margin:0}.permission-option:has(input:checked){border-color:color-mix(in srgb,var(--accent) 50%,var(--rule));background:color-mix(in srgb,var(--accent) 3%,var(--panel))}input[type=checkbox],input[type=radio]{accent-color:var(--btn);width:16px;height:16px;flex:none}.setup-status-title{display:block;font-size:14px;font-weight:650;margin-bottom:4px}.setup-status-description{display:block;font-size:13px;color:var(--muted);line-height:1.55}.drawer-body .setup-step-title{font-weight:650;margin:0;line-height:24px}.guide-step::before{grid-row:1}.guide-steps{gap:24px}.setup-heading p{color:var(--muted);font-size:14px}.setup-copy,.setup-optional{grid-column:2}.setup-copy summary{font-size:13px;cursor:pointer;color:var(--muted);padding:8px 0}.setup-check{margin-top:28px}.setup-check .btn{margin-top:10px}
.task-filters{display:flex;gap:6px;margin:18px 0 12px}.filter-button{padding:7px 12px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:13px;min-height:36px;cursor:pointer}.filter-button[aria-pressed=true]{background:var(--paper);color:var(--ink);font-weight:600}.filter-button:hover{background:var(--paper)}.empty-state{padding:30px 0 36px;max-width:500px}.empty-state strong{display:block;font-size:16px;font-weight:600;margin-bottom:8px}.empty-state p{font-size:14px;color:var(--muted);margin:0 0 16px;max-width:45ch}.side-foot{font-size:12px;gap:12px}.side-foot .linkish{font-size:12px;text-decoration:none}.side-foot .linkish:hover{text-decoration:underline}.drawer-bar{padding:12px 20px}.main-head > .btn{flex:none}
@media (max-width:860px){
 .app{display:flex;flex-direction:column}.side{display:contents}.brand{order:0;padding:22px 20px 16px;display:flex;justify-content:space-between;align-items:center}.brand-crop{width:145px}.live{font-size:11px;gap:5px}.agents-sec{order:1;margin:0 20px 0;padding:12px 14px;background:var(--paper);border-radius:9px}.connections-heading{margin:0}.agents-sec[open] .connections-heading{margin-bottom:14px}.agents{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}.main{order:2;padding:28px 20px 36px}.main-head{gap:12px;margin-bottom:26px;align-items:flex-start}.workspace-title{font-size:22px}.main-head > .btn{font-size:12px;min-height:38px;padding:8px 11px}.summary{font-size:12px;max-width:34ch}.start{padding:20px;margin-bottom:28px}.start h2{font-size:22px}.start-steps{gap:10px 16px}.start-step{font-size:11px}.main .job{grid-template-columns:minmax(0,1fr);gap:8px}.job-time{grid-row:3;text-align:left}.job-line{grid-column:1}.columns{gap:24px}#sched-section{order:3;padding:0 20px 20px}.side-foot{order:4;padding:20px;display:flex;flex-direction:row;flex-wrap:wrap;gap:16px;background:var(--paper);margin:0}.drawer-body{padding:22px 20px 40px}.dialog{padding:22px;width:calc(100% - 24px)}.tiles{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tile{grid-template-columns:28px minmax(0,1fr);padding:10px;gap:4px 8px}.tile .platform-icon{width:28px;height:28px}.tile-blurb{grid-column:1/3;font-size:12px}.tile-name{font-size:13px}.dialog-actions{flex-wrap:wrap}.guide-step{gap:8px}.activity{font-size:12px}
}
@media (max-width:370px){.brand{align-items:flex-start}.live{max-width:110px;line-height:1.3}.agents{grid-template-columns:minmax(0,1fr)}.main-head{flex-wrap:wrap}.tiles{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

const DASHBOARD_JS = String.raw`
(() => {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const HOSTED = document.body.dataset.hosted === "true";
  const CLERK = HOSTED && document.body.dataset.authProvider === "clerk";
  const API_URL = document.body.dataset.apiUrl || "";
  const KEY = "relay_owner_token";
  const ASSETS = JSON.parse(document.body.dataset.assets || "{}");
  if (window.matchMedia("(max-width:860px)").matches) $("#connections-panel").open = false;
  let taskFilter = "all";
  let showSetup = false;
  let csrfToken = null;
  let session = null;
  let sessionEpoch = 0;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "value") n.value = v;
      else if (k === "checked") n.checked = !!v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }

  const TYPE_LABEL = { task: "General task", research: "Research", summarize: "Summarize", monitor: "Keep watch", digest: "Digest", review: "Review", build: "Build" };
  const TYPE_HINT = {
    task: "Describe the goal and include enough context for an assistant starting fresh.",
    research: "e.g. Find the five most-discussed AI agent launches this week, with a link and one line on each.",
    summarize: "e.g. Summarize these three articles in five bullets each: (paste links)",
    monitor: "e.g. Tell me about new posts on X or Hacker News that mention my product since yesterday.",
    digest: "e.g. Put together a short morning roundup of AI coding news.",
    review: "e.g. Review this launch plan and list the three biggest risks: (paste a link or the text)",
    build: "e.g. Fix the broken Contact link in my site's footer and open a pull request. Repo: github.com/you/site",
  };
  const STATUS = {
    needs_approval: ["Needs approval", "--approval"], queued: ["Waiting for pickup", "--queued"], claimed: ["Working", "--working"],
    input_required: ["Needs input", "--question"], completed: ["Result ready", "--done"], failed: ["Failed", "--failed"],
    canceled: ["Canceled", "--closed"], expired: ["Expired", "--closed"],
  };
  const OPEN = new Set(["needs_approval", "queued", "claimed", "input_required"]);
  const POLL = [[5, "5 minutes"], [10, "10 minutes"], [15, "15 minutes"], [30, "30 minutes"], [60, "hour"], [240, "4 hours"], [1440, "day"]];
  const GIVE_UP = [[4320, "3 days"], [60, "1 hour"], [240, "4 hours"], [1440, "1 day"], [10080, "1 week"]];
  const GLYPH = { dot: "●", claude: "Cl", grok: "G", "claude-code": "CC", codex: "Cx", "grok-bot": "Gk", muse: "Mu", chatgpt: "GPT", openclaw: "OC", other: "+" };

  (function takeTokenFromLink() {
    if (HOSTED) { store.del(KEY); if (location.hash.startsWith("#token=")) history.replaceState(null, "", location.pathname + location.search); return; }
    const m = location.hash.match(/^#token=([^&]+)/);
    if (!m) return;
    store.set(KEY, decodeURIComponent(m[1]));
    history.replaceState(null, "", location.pathname + location.search);
  })();

  let token = HOSTED ? null : store.get(KEY);
  let data = null;
  let lastEventId = 0;
  const seenEvents = new Set();
  let timer = null;
  let drawer = null;
  let returnFocus = null;
  let loading = null;
  let pollFailures = 0;
  let running = false;
  // Pairing instructions stay in this tab's memory, never localStorage.
  const pairingCodes = new Map();
  const pairingInFlight = new Set();

  // ------------------------------------------------------------ helpers
  const agentById = (id) => data && data.agents.find((a) => a.id === id);
  const who = (id) => {
    if (id === "owner") return "You";
    if (id === "*") return "any worker";
    if (id === "relay") return "Relay";
    const a = agentById(id);
    return a ? a.name : id;
  };
  const typeWords = (ids) => ids.map((t) => (TYPE_LABEL[t] || t).toLowerCase()).join(", ");
  const pollLabel = (m) => (m >= 1440 ? "day" : m === 60 ? "hour" : m > 60 ? m / 60 + " hours" : m + " min");
  function ago(iso) {
    if (!iso) return "never";
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 45) return "just now";
    if (s < 90 * 60) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 36 * 3600) return Math.round(s / 3600) + " h ago";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  function isLit(a) {
    if (!a.last_seen_at) return false;
    const window = Math.max(15, (a.poll_minutes || 10) * 2) * 60000;
    return Date.now() - Date.parse(a.last_seen_at) < window;
  }
  const platformOf = (a) => data.platforms.find((p) => p.id === a.platform) || data.platforms[data.platforms.length - 1];
  function cadence(a) {
    if (!a.can_work) return "Sends tasks";
    if (a.doorbell) return "Wake-up trigger configured";
    if (a.poll_minutes) return "Check interval: every " + pollLabel(a.poll_minutes) + " (configure in app)";
    return "On demand";
  }
  function pickupText(a) {
    if (!a) return "The first capable agent to check in will take it.";
    if (a.doorbell) return a.name + " has a wake-up trigger. The relay will request a run; timing depends on the provider.";
    if (!a.poll_minutes) {
      return cadence(a) === "On demand"
        ? a.name + " picks up tasks when you ask it to check in an active conversation."
        : a.name + " will pick it up on its next check-in.";
    }
    if (!a.last_seen_at) return a.name + " will pick it up once it's set up and checking in.";
    return "This waits for " + a.name + "’s next check-in. Its saved interval is every " + pollLabel(a.poll_minutes) + "; confirm the recurring task is running in that app. Hitchhike has not verified that schedule.";
  }
  function deriveTitle(text) {
    const line = text.trim().split(/\n/)[0].replace(/^(e\.g\.|please)\s+/i, "").replace(/[.!?:]+$/, "");
    if (line.length <= 80) return line;
    const cut = line.slice(0, 80);
    return cut.slice(0, Math.max(40, cut.lastIndexOf(" "))) + "…";
  }
  function uniqueHandle(base) {
    let slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
    if (!/^[a-z]/.test(slug) || slug.length < 2 || ["owner", "relay", "all", "any", "admin", "me"].includes(slug)) slug = "agent" + (slug ? "-" + slug : "");
    slug = slug.slice(0, 28);
    let id = slug, n = 2;
    while (data.agents.some((a) => a.id === id || a.handle === id)) { const suffix = "-" + n++; id = slug.slice(0, 32 - suffix.length) + suffix; }
    return id;
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const t = el("textarea", { style: "position:fixed;opacity:0", value: text });
      document.body.append(t); t.select();
      const ok = document.execCommand("copy"); t.remove(); return ok;
    }
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 5000);
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = { accept: "application/json", "content-type": "application/json" };
    if (HOSTED) {
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
      if (CLERK) {
        if (!window.AgentConnectAuth) throw new Error("Sign-in is not configured on this deployment yet.");
        const sessionToken = await window.AgentConnectAuth.getToken();
        if (!sessionToken) {
          if (!opts.keepSession) signOut("Your session expired. Sign in again.");
          throw Object.assign(new Error("Your session expired. Sign in again."), { code: "auth" });
        }
        headers.authorization = "Bearer " + sessionToken;
      }
    } else if (token) headers.authorization = "Bearer " + token;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const res = await fetch(API_URL + path, {
      credentials: API_URL ? "omit" : "same-origin",
      method: opts.method || "GET",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      headers,
    });
    let body = {};
    try { body = await res.json(); } catch {}
    if (res.status === 401 || (res.status === 403 && body.error && body.error.code === "owner_only")) {
      if (!opts.keepSession) signOut(HOSTED ? "Your session expired. Sign in again." : "That key wasn't accepted.");
      throw Object.assign(new Error("auth"), { code: "auth" });
    }
    if (!res.ok) throw Object.assign(new Error((body.error && body.error.message) || "The relay returned " + res.status + "."), { code: body.error && body.error.code, status: res.status });
    return body;
  }

  function status(s) {
    const pair = STATUS[s] || [s, "--queued"];
    return el("span", { class: "status", style: "--s:var(" + pair[1] + ")" }, pair[0]);
  }
  function jobStatus(j) {
    if (j.status === "completed" && j.result && j.result.validation && !j.result.validation.ok) return el("span", { class: "status", style: "--s:var(--approval)" }, "Validation issues");
    if (j.status === "completed" && j.retrieved_at) return el("span", { class: "status", style: "--s:var(--done)" }, "Result retrieved");
    return status(j.status);
  }
  const route = (job) => el("span", { class: "route", "aria-label": who(job.from) + " to " + who(job.to) }, who(job.from), el("span", { "aria-hidden": "true", class: "route-arrow" }, "→"), who(job.to));
  const lamp = (a, extra) => el("span", { class: "lamp" + (a && isLit(a) ? " lit" : "") + (extra ? " " + extra : ""), "aria-hidden": "true" });

  // ------------------------------------------------------------ sign in
  function signOut(message) {
    token = null;
    showSetup = false;
    taskFilter = "all";
    $$("[data-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.filter === "all")));
    store.del(KEY);
    running = false;
    clearTimeout(timer);
    csrfToken = null;
    session = null;
    sessionEpoch++;
    pairingCodes.clear();
    pairingInFlight.clear();
    data = null;
    seenEvents.clear();
    lastEventId = 0;
    closeDrawer();
    $("#connect-dialog").close();
    $("#drawer-body").replaceChildren();
    if ($("#auth-loading")) $("#auth-loading").hidden = true;
    $("#app").hidden = true;
    $("#gate").hidden = false;
    const err = $(HOSTED ? "#session-error" : "#gate-error");
    err.hidden = !message;
    err.textContent = message || "";
    if (!HOSTED) $("#gate-token").focus();
  }
  $("#gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (HOSTED) return;
    token = $("#gate-token").value.trim();
    try {
      await load(true);
      store.set(KEY, token);
      start();
    } catch (err) {
      if (err.code !== "auth") { $("#gate-error").hidden = false; $("#gate-error").textContent = err.message; }
    }
  });
  async function finishSignOut(message) {
    if (CLERK) {
      try { const clerk = await window.AgentConnectAuth.ready; await clerk.signOut(function() {}); }
      catch { signOut((message ? message + " " : "") + "Your Hitchhike session has ended. The sign-in provider could not finish signing out; reload before using another account."); return; }
    }
    signOut(message || "");
  }
  $("#sign-out").addEventListener("click", async () => {
    if (HOSTED) { try { await api("/auth/logout", { method: "POST", body: {} }); } catch (e) { if (e.code !== "auth") { toast(e.message); return; } } }
    await finishSignOut("");
  });
  $("#copy-link").addEventListener("click", async () => {
    await copy(location.origin + "/#token=" + encodeURIComponent(token));
    toast("Sign-in link copied. Anyone with it can manage this relay, so open it only on your own devices.");
  });

  // ------------------------------------------------------------ data
  async function load(first) {
    if (loading) return loading;
    loading = fetchOverview(first);
    try { return await loading; } finally { loading = null; }
  }
  async function fetchOverview(first) {
    const epoch = sessionEpoch;
    const next = await api("/v1/admin/overview");
    if (epoch !== sessionEpoch) return;
    if (first && next.release?.enabled && new URLSearchParams(location.search).get("experience") !== "legacy") {
      location.replace(location.pathname === "/app" ? "/app-next" : "/beta");
      return;
    }
    pollFailures = 0;
    const fresh = new Set();
    for (const ev of next.events) if (!first && !seenEvents.has(ev.id) && ev.id > lastEventId) fresh.add(ev.actor);
    data = next;
    render(fresh, first);
    for (const ev of next.events) seenEvents.add(ev.id);
    lastEventId = next.events.reduce((m, e) => Math.max(m, e.id), lastEventId);
    $("#live-dot").classList.add("on");
    $("#live-text").textContent = "Updated " + new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }
  function start() {
    if ($("#auth-loading")) $("#auth-loading").hidden = true;
    $("#gate").hidden = true;
    $("#app").hidden = false;
    running = true;
    scheduleRefresh();
    const hash = location.hash.slice(1);
    if (hash.startsWith("job_")) openJob(hash);
  }
  function scheduleRefresh() {
    clearTimeout(timer);
    if (!running || document.hidden) return;
    const active = data && data.jobs.some((j) => OPEN.has(j.status));
    const delay = pollFailures ? Math.min(60000, 15000 * (pollFailures + 1)) : active || (drawer && drawer.kind === "setup") ? 15000 : 45000;
    timer = setTimeout(async () => { try { await load(false); } catch (e) { onLoadError(e); } finally { scheduleRefresh(); } }, delay);
  }
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (running && !document.hidden) load(false).catch(onLoadError).finally(scheduleRefresh);
  });
  function onLoadError(err) {
    if (err.code === "auth") return;
    pollFailures++;
    $("#live-dot").classList.remove("on");
    $("#live-text").textContent = "Can't reach the relay. Retrying.";
  }

  // ------------------------------------------------------------ render
  function render(fresh, first) {
    const focused = document.activeElement && document.activeElement.dataset;
    const focusedJob = focused && focused.jobId;
    const focusedAgent = focused && focused.agentId;
    const focusedKey = focused && focused.focusKey;
    renderSummary();
    renderAgents(fresh);
    renderSchedules();
    renderStart();
    renderNeeds();
    renderJobs();
    renderActivity(first);
    refreshDrawer();
    if (!drawer && !$("#connect-dialog").open) {
      const target = focusedJob ? $$("[data-job-id]").find((n) => n.dataset.jobId === focusedJob)
        : focusedAgent ? $$("[data-agent-id]").find((n) => n.dataset.agentId === focusedAgent)
        : focusedKey ? $$("[data-focus-key]").find((n) => n.dataset.focusKey === focusedKey) : null;
      if (target) target.focus({ preventScroll: true });
    }
  }

  function platformIcon(id) {
    const extensions = { chatgpt: "svg", claude: "svg", muse: "svg", "grok-bot": "svg", codex: "png", "claude-code": "png", grok: "png" };
    const url = extensions[id] && ASSETS["assets/agents/" + id + "." + extensions[id]];
    return url ? el("span", { class: "platform-icon" + (id === "codex" ? " inverse" : ""), "aria-hidden": "true" }, el("img", { src: url, alt: "", width: "30", height: "30" }))
      : el("span", { class: "glyph platform-icon", "aria-hidden": "true" }, GLYPH[id] || "+");
  }
  function renderSummary() {
    const total = data.agents.length;
    const working = data.jobs.filter((j) => j.status === "claimed").length;
    const waiting = data.jobs.filter((j) => j.status === "queued").length;
    const parts = [total ? total + (total === 1 ? " connection" : " connections") : "Connect your agents to get started"];
    if (working) parts.push(working + " working");
    if (waiting) parts.push(waiting + " waiting for pickup");
    $("#summary").textContent = parts.join(" · ");
    $("#connection-count").textContent = String(total);
    $("#compose").hidden = !total;
  }

  function renderAgents(fresh) {
    const list = $("#agents");
    list.replaceChildren();
    if (!data.agents.length) {
      list.append(el("li", { class: "empty" }, "Your connected apps will appear here."));
      return;
    }
    for (const a of data.agents) {
      const waiting = data.jobs.filter((j) => j.status === "queued" && j.to === a.id).length;
      const bits = [a.stats.working ? "working on " + a.stats.working : null, waiting ? waiting + " waiting" : null].filter(Boolean);
      const state = bits.length ? bits.join(", ") : a.last_seen_at ? "seen " + ago(a.last_seen_at) : "Awaiting connection";
      const does = cadence(a);
      list.append(
        el("li", { class: "agent", "data-agent-id": a.id, tabindex: "0", role: "button", "aria-label": a.name + ", " + state, onclick: () => openAgent(a.id), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAgent(a.id); } } },
          platformIcon(a.platform),
          el("span", { class: "agent-name" }, a.name),
          el("span", { class: "agent-state" }, state),
          el("span", { class: "agent-meta" }, does || "no role yet"),
        ),
      );
    }
  }

  function renderSchedules() {
    const list = $("#schedules");
    list.replaceChildren();
    $("#sched-section").hidden = !data.schedules.length;
    for (const s of data.schedules) {
      const every = s.every_minutes % 1440 === 0 ? (s.every_minutes === 1440 ? "Every day" : "Every " + s.every_minutes / 1440 + " days")
        : s.every_minutes % 60 === 0 ? "Every " + (s.every_minutes === 60 ? "hour" : s.every_minutes / 60 + " hours") : "Every " + s.every_minutes + " min";
      const retry = s.enabled && s.consecutive_failures && s.next_attempt_at
        ? " Retry " + new Date(s.next_attempt_at).toLocaleString() + " after " + s.consecutive_failures + (s.consecutive_failures === 1 ? " failed run." : " failed runs.") : "";
      list.append(el("li", { class: "schedule" }, el("b", {}, every), ": ", who(s.to), " — ", (TYPE_LABEL[s.type] || s.type).toLowerCase(), " “", s.title, "”", s.enabled ? "" : " (paused)",
        s.disabled_reason ? el("div", { class: "help" }, s.disabled_reason) : null,
        retry ? el("div", { class: "help" }, retry) : null,
        s.last_error ? el("div", { class: "help" }, "Last error: " + s.last_error) : null));
    }
  }

  function startKey() { return "relay_start_hidden:" + (HOSTED && session && session.workspace ? session.workspace.id : "default"); }
  function renderStart() {
    const connected = data.agents.filter((a) => a.last_seen_at);
    const hasTwo = connected.length >= 2;
    const tested = data.agents.some((a) => verifiedTest(a));
    const hasHandoff = data.jobs.some((j) => j.status === "completed" && !(j.inputs && j.inputs.connection_test));
    $("#start").hidden = !showSetup && (store.get(startKey()) === "1" || (hasTwo && hasHandoff));
    const pending = data.agents.find((a) => !a.last_seen_at);
    const worker = connected.find((a) => a.can_work && testJob(a) && OPEN.has(testJob(a).status)) || connected.find((a) => a.can_work);
    let title, description, label, action, current = 0;
    if (!data.agents.length) {
      title = "Start with the assistant you use most";
      description = "Connect it to Hitchhike, then add another agent it can work with. We'll walk you through each connection.";
      label = "Connect your first agent"; action = () => openConnect();
    } else if (!hasTwo && pending) {
      title = "Finish connecting " + pending.name;
      description = "Your connection is saved. Add Hitchhike in " + platformOf(pending).label + " and ask it to check in. This page updates when it makes contact.";
      label = "Continue setup"; action = () => openSetup(pending.id);
    } else if (!hasTwo) {
      title = "Give your assistant someone to work with";
      description = connected[0].name + " has checked in. Connect a second app so they can pass work back and forth.";
      label = "Connect another agent"; action = () => openConnect();
    } else if (!worker) {
      title = "Add an agent that can receive work";
      description = "Your connections can send tasks. Add a receiver, or enable Receive tasks in a connection's settings.";
      label = "Connect a receiver"; action = () => openConnect();
    } else if (!tested) {
      current = 1;
      const existing = testJob(worker);
      const inProgress = existing && OPEN.has(existing.status);
      title = inProgress ? "Your connection test is waiting" : "Try a small connection test";
      description = inProgress ? pickupText(worker) : "Send " + worker.name + " a harmless test and check that its answer makes it back.";
      label = existing && (inProgress || existing.status === "completed") ? "View test" : "Test " + worker.name;
      action = () => existing && (inProgress || existing.status === "completed") ? openJob(existing.id) : runTest(worker.id);
    } else {
      current = 2; title = "You're ready for a useful handoff";
      description = "Ask your assistant to send a task to another connection, with the context it needs. You can also send one from here.";
      label = "Send a task"; action = () => openCompose();
    }
    $("#h-start").textContent = title;
    $("#start-description").textContent = description;
    const wasFocused = document.activeElement && document.activeElement.id === "start-continue";
    $("#start-action").replaceChildren(el("button", { id: "start-continue", class: "btn", onclick: action }, label));
    $("#start-steps").replaceChildren(...["Connect two agents", "Check the connection", "Hand off work"].map((title, i) => {
      const done = i === 0 ? hasTwo : i === 1 ? tested : hasHandoff;
      return el("li", { class: "start-step" + (done ? " done" : i === current ? " current" : ""), "aria-current": !done && i === current ? "step" : null },
        el("span", { class: "step-num", "aria-hidden": "true" }, done ? "✓" : String(i + 1)),
        el("span", {}, title), done ? el("span", { class: "sr-only" }, " complete") : null);
    }));
    if (wasFocused && !$("#start").hidden) $("#start-continue").focus({ preventScroll: true });
  }

  $("#start-hide").addEventListener("click", () => { showSetup = false; store.set(startKey(), "1"); $("#start").hidden = true; });

  function renderNeeds() {
    const items = data.jobs.filter((j) => j.status === "needs_approval" || j.status === "input_required");
    $("#needs").hidden = !items.length;
    const list = $("#needs-list");
    list.replaceChildren();
    for (const j of items) {
      const q = j.thread.filter((t) => t.kind === "question").pop();
      const text = j.status === "needs_approval"
        ? el("span", { class: "need-text" }, el("b", {}, who(j.from)), " wants ", el("b", {}, who(j.to)), " to run a build job: “", j.title, "”")
        : el("span", { class: "need-text" }, el("b", {}, who(q ? q.from : j.to)), " asked ", el("b", {}, who(j.from)), ": “", q ? q.text : j.title, "”");
      const actions = el("span", { class: "need-actions" });
      if (j.status === "needs_approval") actions.append(el("button", { class: "btn small", "data-focus-key": "approve:" + j.id, onclick: () => act(j.id, "approve") }, "Approve"), el("button", { class: "btn small quiet", "data-focus-key": "review:" + j.id, onclick: () => openJob(j.id) }, "Review"));
      else actions.append(el("button", { class: "btn small quiet", "data-focus-key": "answer:" + j.id, onclick: () => openJob(j.id) }, "Answer"));
      list.append(el("li", { class: "need" }, text, actions));
    }
  }

  function renderJobs() {
    const list = $("#jobs");
    list.replaceChildren();
    const jobs = data.jobs.filter((j) => taskFilter === "open" ? OPEN.has(j.status) : taskFilter === "results" ? j.status === "completed" : true);
    $("#job-count").textContent = jobs.length ? jobs.length + (jobs.length === 1 ? " task" : " tasks") : "";
    if (!jobs.length) {
      const isEmpty = !data.jobs.length;
      list.append(el("li", { class: "empty-state" },
        el("strong", {}, isEmpty ? "Your first handoff starts here" : taskFilter === "results" ? "No results yet" : "Nothing in progress"),
        el("p", {}, isEmpty ? "Ask a connected assistant to pass work to another agent, or send a task yourself." : taskFilter === "results" ? "Completed answers will appear here when an agent returns its work." : "New tasks will appear here while they wait for pickup or are being worked on."),
        isEmpty ? el("button", { class: "btn quiet", onclick: () => workers().length ? openCompose() : openConnect() }, workers().length ? "Send a task" : "Connect an agent") : null));
      return;
    }
    for (const j of jobs) {
      const when = j.completed_at ? "Finished " + ago(j.completed_at) : "Sent " + ago(j.created_at);
      list.append(
        el("li", { class: "job", "data-job-id": j.id, tabindex: "0", role: "button", "aria-current": drawer && drawer.kind === "job" && drawer.id === j.id ? "true" : "false", onclick: () => openJob(j.id), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openJob(j.id); } } },
          el("span", { class: "job-title" }, j.title),
          el("span", { class: "job-time" }, when),
          el("span", { class: "job-line" }, jobStatus(j), route(j), j.result && j.result.validation && !j.result.validation.ok ? el("span", { style: "color:var(--approval)" }, "Needs review") : null)));
    }
  }
  $$("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    taskFilter = button.dataset.filter;
    $$("[data-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    renderJobs();
  }));

  function describe(ev) {
    const d = ev.detail || {};
    const t = ev.job && ev.job.title ? "“" + ev.job.title + "”" : "a job";
    const T = t.charAt(0).toUpperCase() + t.slice(1);
    const W = (id) => el("span", { class: "who" }, who(id));
    switch (ev.kind) {
      case "created": return [W(ev.actor), " asked ", W(d.to), (d.type === "task" ? " to work on " : " to " + (TYPE_LABEL[d.type] || d.type).toLowerCase() + " ") + t + (d.status === "needs_approval" ? ". Waiting for your approval." : "")];
      case "claimed": return [W(ev.actor), " picked up " + t];
      case "claim_resent": return [W(ev.actor), " checked back in on " + t];
      case "completed": return [W(ev.actor), " finished " + t + (d.validation_ok === false ? ", with problems flagged" : "")];
      case "submission_rejected": return ["Relay sent ", W(ev.actor), "’s answer back: " + (d.errors || []).length + " thing" + ((d.errors || []).length === 1 ? "" : "s") + " to fix"];
      case "input_requested": return [W(ev.actor), " asked ", W(ev.job && ev.job.from), ": “" + (d.question || "") + "”"];
      case "answered": return [W(ev.actor), " answered the question on " + t];
      case "sent_back": return [W(ev.actor), " sent " + t + " back with feedback"];
      case "accepted": return [W(ev.actor), " accepted the result of " + t];
      case "approved": return [W(ev.actor), " approved " + t];
      case "canceled": return ev.actor === "relay" ? [T + " was canceled: " + (d.reason || "")] : [W(ev.actor), " canceled " + t];
      case "lease_expired": return [T + " went back in the queue; its worker went quiet"];
      case "failed": return [T + " failed" + (d.reason ? ": " + d.reason : "")];
      case "expired": return [T + " expired before anyone finished it"];
      case "doorbell": return ["Woke ", W(d.agent), d.ok ? " about " + t : " about " + t + " (no answer)"];
      case "agent_added": return ["Connection created for ", W(d.agent)];
      case "agent_updated": return [W(d.agent), "’s settings changed"];
      case "token_rotated": return [W(d.agent), " got a new key"];
      case "agent_removed": return [d.agent + " was disconnected"];
      case "schedule_saved": return ["Schedule " + d.schedule + " saved"];
      case "schedule_removed": return ["Schedule " + d.schedule + " removed"];
      case "schedule_failed": return ["Schedule " + d.schedule + " couldn’t run: " + (d.error || "")];
      default: return [W(ev.actor), " " + ev.kind.replace(/_/g, " ")];
    }
  }

  function renderActivity(first) {
    const list = $("#activity");
    list.replaceChildren();
    if (!data.events.length) { list.append(el("li", { class: "empty" }, "Nothing yet. Everything your agents ask and answer shows up here.")); return; }
    for (const ev of data.events) {
      const dim = ev.kind === "claim_resent" || ev.kind === "doorbell";
      const fresh = !first && !seenEvents.has(ev.id);
      list.append(el("li", { class: "event" + (dim ? " dim" : "") + (fresh ? " fresh" : "") },
        el("time", { datetime: ev.ts, title: new Date(ev.ts).toLocaleString() }, clock(ev.ts)),
        ev.job_id ? el("button", { class: "event-link", "data-focus-key": "event:" + ev.id, onclick: () => openJob(ev.job_id) }, describe(ev)) : el("span", {}, describe(ev))));
    }
  }

  // ------------------------------------------------------------ drawer
  function openDrawer() {
    if (!$("#drawer").classList.contains("open")) returnFocus = document.activeElement;
    $("#app").inert = true;
    $("#drawer").classList.add("open");
    $("#scrim").hidden = false;
    setTimeout(() => { if (drawer) $("#drawer").focus(); }, 30);
    scheduleRefresh();
  }
  function closeDrawer() {
    drawer = null;
    $("#app").inert = false;
    $("#drawer").classList.remove("open");
    $("#scrim").hidden = true;
    if (location.hash) history.replaceState(null, "", location.pathname);
    if (data) renderJobs();
    if (returnFocus && !$("#app").hidden) {
      const d = returnFocus.dataset || {};
      const target = d.jobId ? $$("[data-job-id]").find((n) => n.dataset.jobId === d.jobId)
        : d.agentId ? $$("[data-agent-id]").find((n) => n.dataset.agentId === d.agentId)
        : d.focusKey ? $$("[data-focus-key]").find((n) => n.dataset.focusKey === d.focusKey) : returnFocus;
      if (target && target.isConnected && target.matches("button,a,input,select,textarea,[tabindex]")) target.focus(); else $("#compose").focus();
    }
    returnFocus = null;
  }
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (!drawer || $("#connect-dialog").open) return;
    if (e.key === "Escape") closeDrawer();
    if (e.key === "Tab") {
      const nodes = $$("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex='0']", $("#drawer")).filter((n) => n.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === $("#drawer"))) { e.preventDefault(); if (last) last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === $("#drawer"))) { e.preventDefault(); if (first) first.focus(); }
    }
  });
  const body = () => $("#drawer-body");

  function refreshDrawer() {
    if (!drawer) return;
    if (drawer.kind === "job") renderJobDrawer(false);
    else if (drawer.kind === "agent") renderAgentDrawer();
    else if (drawer.kind === "setup") updateSetupStatus();
  }

  // Job ---------------------------------------------------------------
  function openJob(id) {
    drawer = { kind: "job", id };
    history.replaceState(null, "", "#" + id);
    renderJobDrawer(true);
    openDrawer();
    renderJobs();
  }
  const drafts = {};
  const resultRevision = (job) => job.result ? JSON.stringify([job.attempts, job.result.submitted_at, job.result.worker, job.completed_at]) : null;
  const workAttempts = (job) => Math.max(0, job.attempts - (job.clarification_rounds || 0));
  async function renderJobDrawer(fetchFull) {
    const id = drawer.id;
    let job = data && data.jobs.find((j) => j.id === id);
    if (!job || fetchFull) {
      try { job = (await api("/v1/jobs/" + encodeURIComponent(id))).job; }
      catch (e) { if (!job) { body().replaceChildren(el("p", { class: "error" }, e.message)); return; } }
    }
    if (!drawer || drawer.kind !== "job" || drawer.id !== id) return;
    const revision = resultRevision(job);
    if (drawer.resultRevision !== revision) {
      drawer.resultRevision = revision;
      delete drawer.fullResult;
    }
    const signature = JSON.stringify(job);
    if (!fetchFull && drawer.signature === signature) return;
    drawer.signature = signature;
    const openSections = new Set($$("details[data-disclosure][open]", body()).map((n) => n.dataset.disclosure));
    const active = document.activeElement;
    const focused = active && active.dataset && active.dataset.draft;
    const selection = focused ? [active.selectionStart, active.selectionEnd] : null;
    const k = [];
    k.push(el("h2", {}, job.title));
    k.push(el("div", { class: "meta" }, jobStatus(job), route(job)));
    if (job.lease) k.push(el("p", { class: "muted" }, who(job.lease.holder) + " is working on it until " + clock(job.lease.expires_at) + "."));
    if (job.status === "queued" && job.to !== "*") k.push(el("p", { class: "muted" }, pickupText(agentById(job.to))));
    const actions = el("div", { class: "actions" });
    if (job.status === "needs_approval") actions.append(el("button", { class: "btn", onclick: () => act(id, "approve") }, "Approve"));
    if (OPEN.has(job.status)) actions.append(el("button", { class: "btn quiet", onclick: () => { if (confirm("Cancel this job?")) act(id, "cancel"); } }, "Cancel task"));
    if (actions.childNodes.length) k.push(actions);
    if (job.status === "input_required") {
      const q = job.thread.filter((t) => t.kind === "question").pop();
      k.push(el("h3", {}, who(q ? q.from : job.to) + " asked"), el("p", { class: "prose" }, q ? q.text : ""));
      k.push(replyBox(id, "reply", "Your answer", "Send answer"));
    }
    if (job.result) {
      const r = job.result;
      k.push(el("h3", {}, "Result from " + who(r.worker)));
      k.push(el("p", { class: "prose" }, r.summary || "(No summary.)"));
      if (r.validation && !r.validation.ok) k.push(el("div", { class: "note flagged" }, el("b", {}, "Validation issues: "), r.validation.errors.join(" ")));
      if (r.data !== undefined) k.push(el("details", { class: "more result-data", "data-disclosure": "data" }, el("summary", {}, "Structured data"), el("pre", { class: "pre" }, JSON.stringify(r.data, null, 2))));
      if (r.sources && r.sources.length) k.push(el("h3", {}, "Sources"), el("ul", { class: "list sources" }, r.sources.map((s) => el("li", {}, /^https:\/\//.test(s.url) ? el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer nofollow" }, s.title || s.url) : s.url))));
      if (r.body_chars) {
        const holder = el("div", {});
        if (typeof drawer.fullResult === "string") holder.append(el("h3", {}, "Full result"), el("pre", { class: "pre" }, drawer.fullResult));
        else holder.append(el("button", { class: "btn quiet small", onclick: async () => {
          const current = drawer;
          try {
            const full = (await api("/v1/jobs/" + encodeURIComponent(id) + "?full=1")).job;
            if (drawer !== current || drawer.resultRevision !== revision) return;
            if (resultRevision(full) !== revision) { await load(false); return; }
            drawer.fullResult = full.result.body || "";
            drawer.signature = null;
            await renderJobDrawer(false);
          } catch (e) { if (drawer === current) toast(e.message); }
        } }, "Read full result"));
        k.push(holder);
      }
      k.push(el("p", { class: "note" }, "Returned by " + who(r.worker) + ". Validation checks the result format, not factual accuracy or whether every requested action succeeded."));
      if (job.status === "completed") k.push(el("div", { class: "actions" }, el("button", { class: "btn", onclick: () => act(id, "accept") }, "Accept result")));
      if (job.status === "completed" && workAttempts(job) < job.max_attempts) k.push(el("details", { class: "more", "data-disclosure": "feedback" }, el("summary", {}, "Request changes"), replyBox(id, "reject", "What should change?", "Send feedback")));
    }
    if (job.error && job.status !== "completed") k.push(el("div", { class: "note flagged" }, job.error));
    if (job.max_clarification_rounds && job.clarification_rounds >= job.max_clarification_rounds) k.push(
      el("p", { class: "note" }, "This task has used its clarification limit. The agent can finish with the available information; start a follow-up task if more input is needed."),
      el("button", { class: "btn quiet small", onclick: () => openCompose(job.to === "*" ? undefined : job.to) }, "Start a follow-up task"));
    k.push(el("h3", {}, "Task"), el("p", { class: "prose" }, job.goal));
    if (job.inputs && Object.keys(job.inputs).length) k.push(el("details", { class: "more", "data-disclosure": "inputs" }, el("summary", {}, "Task context"), el("pre", { class: "pre" }, JSON.stringify(job.inputs, null, 2))));
    if (job.constraints && job.constraints.length) k.push(el("h3", {}, "Constraints"), el("ul", { class: "list" }, job.constraints.map((c) => el("li", {}, c))));
    if (job.acceptance && job.acceptance.length) k.push(el("h3", {}, "Done when"), el("ul", { class: "list" }, job.acceptance.map((c) => el("li", {}, c))));
    const past = job.thread.filter((t) => job.status !== "input_required" || t !== job.thread[job.thread.length - 1]);
    if (past.length) k.push(el("h3", {}, "Conversation"), el("ul", { class: "list" }, past.map((t) => el("li", {}, el("b", {}, who(t.from)), (t.kind === "question" ? " asked: " : t.kind === "reply" ? " answered: " : " sent it back: ") + t.text))));
    k.push(el("details", { class: "more", "data-disclosure": "details" }, el("summary", {}, "Task details"),
      el("p", { class: "help" }, el("span", { class: "mono" }, job.id), el("br"), "Sent " + new Date(job.created_at).toLocaleString(), el("br"), "Work attempt " + workAttempts(job) + " of " + job.max_attempts,
        job.max_clarification_rounds ? [el("br"), "Clarifications answered " + (job.clarification_rounds || 0) + " of " + job.max_clarification_rounds] : null,
        job.expires_at && OPEN.has(job.status) ? ". Expires " + new Date(job.expires_at).toLocaleString() + "." : "")));
    body().replaceChildren(...k);
    $$("details[data-disclosure]", body()).forEach((node) => { node.open = openSections.has(node.dataset.disclosure); });
    if (focused) { const again = body().querySelector('[data-draft="' + focused + '"]'); if (again) { again.focus({ preventScroll: true }); again.setSelectionRange(selection[0], selection[1]); } }
  }

  function replyBox(id, action, label, button) {
    const key = id + ":" + action;
    const area = el("textarea", { "data-draft": key, "aria-label": label, placeholder: label, oninput: (e) => (drafts[key] = e.target.value) });
    area.value = drafts[key] || "";
    const send = el("button", { class: "btn", onclick: async () => {
      if (!area.value.trim()) { area.focus(); return; }
      send.disabled = true;
      try { await act(id, action, area.value.trim()); delete drafts[key]; } finally { send.disabled = false; }
    } }, button);
    return el("div", { class: "reply" }, el("h3", {}, label), area, el("div", {}, send));
  }
  async function act(id, action, text) {
    try {
      await api("/v1/jobs/" + encodeURIComponent(id) + "/" + action, { method: "POST", body: text ? { message: text, feedback: text } : {} });
      await load(false);
      if (drawer && drawer.kind === "job" && drawer.id === id) renderJobDrawer(true);
    } catch (e) { if (e.code !== "auth") alert(e.message); }
  }

  // Agent -------------------------------------------------------------
  function openAgent(id) { drawer = { kind: "agent", id }; renderAgentDrawer(); openDrawer(); }
  function renderAgentDrawer() {
    const a = agentById(drawer.id);
    if (!a) { body().replaceChildren(el("p", { class: "muted" }, "This agent was disconnected.")); return; }
    if (body().contains(document.activeElement) && document.activeElement.matches("input")) return;
    const k = [
      el("h2", {}, a.name),
      el("div", { class: "meta" }, lamp(a), el("span", {}, a.last_seen_at ? "Last seen " + ago(a.last_seen_at) : "Hasn't checked in yet"), a.platform_label !== a.name ? el("span", {}, a.platform_label) : null, el("span", {}, cadence(a))),
      el("div", { class: "actions" },
        a.can_work ? el("button", { class: "btn", onclick: () => openCompose(a.id) }, "Send a task") : null,
        el("button", { class: "btn quiet", onclick: () => openSetup(a.id) }, "Setup instructions"),
        el("button", { class: "btn quiet", onclick: () => openEdit(a.id) }, "Edit settings")),
      el("p", { class: "note" }, readiness(a)),
      a.can_work ? el("button", { class: "btn quiet small", onclick: () => runTest(a.id) }, "Run a test task") : null,
      el("h3", {}, "Permissions"),
      el("ul", { class: "list" },
        a.can_work ? el("li", {}, "Takes " + (typeWords(a.work_types) || "no") + " jobs from " + (a.accept_from.includes("*") ? "you and any agent on this relay" : "you and " + a.accept_from.filter((x) => x !== "owner").map(who).join(", ")) + ", up to " + a.daily_work_limit + " a day.") : null,
        a.can_request ? el("li", {}, "Hands work to " + (a.request_targets.includes("*") ? "any agent on this relay" : a.request_targets.map(who).join(", ")) + ", up to " + a.daily_job_limit + " jobs a day.") : null,
        !a.can_work && !a.can_request ? el("li", {}, "Nothing yet.") : null),
    ];
    if (!HOSTED && a.can_work && a.connects === "routine") {
      const url = el("input", { type: "url", placeholder: "https://… (the trigger's URL)", "aria-label": "Wake-up URL" });
      const key = el("input", { type: "password", placeholder: "Key or token (optional)", "aria-label": "Wake-up key" });
      k.push(el("h3", {}, "Wake it up instantly (optional)"),
        el("p", { class: "help" }, a.doorbell ? "The relay pings " + a.doorbell.url + " the moment a job arrives for " + a.name + "." : "If " + a.name + " can start a routine from a webhook, paste its URL and key. The relay pings it the moment a job arrives instead of waiting for the next check-in."),
        el("div", { class: "field" }, url, key, el("div", { class: "row" },
          el("button", { class: "btn small", onclick: async () => {
            if (!/^https:\/\//.test(url.value.trim())) { toast("Paste the https URL of the webhook trigger."); return; }
            try { await api("/v1/admin/agents", { method: "POST", body: { id: a.id, wake_url: url.value.trim(), wake_headers: key.value.trim() ? { Authorization: "Bearer " + key.value.trim() } : null } }); toast(a.name + " will be woken up when work arrives."); await load(false); }
            catch (e) { if (e.code !== "auth") toast(e.message); }
          } }, "Save"),
          a.doorbell ? el("button", { class: "btn small quiet", onclick: async () => { await api("/v1/admin/agents", { method: "POST", body: { id: a.id, wake_url: null, wake_headers: null } }); toast("Removed."); await load(false); } }, "Remove") : null)));
    }
    k.push(el("h3", {}, "Last 24 hours"), el("p", {}, "Sent " + a.stats.sent_24h + ", picked up " + a.stats.claimed_24h + ". " + a.stats.completed_total + " finished in total."));
    k.push(el("h3", {}, "Connection access"), el("p", { class: "help" }, (HOSTED
      ? "Replace credentials to revoke this connection’s current authorization and keys. To authorize an added MCP permission, repeat authorization in your app."
      : "Get a new key to replace this connection’s current key.") + " Disconnect revokes relay access. Work already running in another app may continue."),
      el("div", { class: "actions" },
        el("button", { class: "btn quiet", onclick: () => rotate(a) }, HOSTED ? "Replace credentials" : "Get a new key"),
        el("button", { class: "btn quiet", onclick: async () => {
          if (!confirm("Disconnect " + a.name + "? Its key stops working and its open jobs are canceled.")) return;
          try { await api("/v1/admin/agents/" + encodeURIComponent(a.id), { method: "DELETE" }); pairingCodes.delete(a.id); closeDrawer(); await load(false); } catch (e) { if (e.code !== "auth") alert(e.message); }
        } }, "Disconnect")));
    body().replaceChildren(...k);
  }
  async function rotate(a) {
    if (!confirm("Replace " + a.name + "’s credentials? Existing credentials stop working and you will need to authorize or pair the connection again.")) return;
    try { const out = await api("/v1/admin/agents", { method: "POST", body: { id: a.id, rotate_token: true } }); pairingCodes.delete(a.id); openSetup(a.id, out.guide, out.pairing); await load(false); }
    catch (e) { if (e.code !== "auth") alert(e.message); }
  }

  // Setup -------------------------------------------------------------
  function rememberPairing(id, guide, pairing) {
    if (!HOSTED || !pairing || !pairing.expires_at || !guide.steps[0]?.copy) return;
    if (data.platforms.find((p) => p.id === guide.platform)?.connects === "mcp") return;
    const expires = pairing.expires_at;
    if (Date.parse(expires) <= Date.now()) return;
    pairingCodes.set(id, { instructions: guide.steps[0].copy, expires_at: expires });
    const epoch = sessionEpoch;
    setTimeout(() => {
      if (epoch !== sessionEpoch || pairingCodes.get(id)?.expires_at !== expires) return;
      pairingCodes.delete(id);
      if (drawer && drawer.kind === "setup" && drawer.id === id) renderSetup();
    }, Math.max(0, Date.parse(expires) - Date.now()));
  }
  function currentPairing(id) {
    const pairing = pairingCodes.get(id);
    if (pairing && Date.parse(pairing.expires_at) > Date.now()) return pairing;
    pairingCodes.delete(id);
    return null;
  }
  async function newPairingCode(id) {
    if (pairingInFlight.has(id)) return;
    pairingInFlight.add(id);
    const epoch = sessionEpoch;
    const button = $("#new-pairing-code");
    if (button) button.disabled = true;
    try {
      const out = await api("/v1/admin/agents/" + encodeURIComponent(id) + "/pairing", { method: "POST", body: {} });
      if (epoch !== sessionEpoch) return;
      rememberPairing(id, { platform: agentById(id)?.platform, steps: [{ copy: out.instructions }] }, out);
      if (drawer && drawer.kind === "setup" && drawer.id === id) renderSetup();
      toast("New pairing code ready. Any earlier unused code has been replaced.");
    } catch (e) { if (e.code !== "auth" && epoch === sessionEpoch) toast(e.message); }
    finally {
      if (epoch === sessionEpoch) {
        pairingInFlight.delete(id);
        if (drawer && drawer.kind === "setup" && drawer.id === id) { const current = $("#new-pairing-code"); if (current) current.disabled = false; }
      }
    }
  }
  async function openSetup(id, guide, pairing, promptTarget) {
    if (guide) rememberPairing(id, guide, pairing);
    drawer = { kind: "setup", id, guide: guide || null, promptTarget };
    const setup = drawer;
    body().replaceChildren(el("p", { class: "muted" }, "Loading setup instructions…"));
    openDrawer();
    if (!guide) {
      try {
        const response = await api("/v1/admin/agents/" + encodeURIComponent(id) + "/setup");
        if (drawer !== setup) return;
        setup.guide = response.guide;
      }
      catch (e) {
        if (e.code === "auth") return;
        if (drawer !== setup) return;
        body().replaceChildren(el("h2", {}, "Setup instructions"), el("p", { class: "error", role: "alert" }, e.message), el("button", { class: "btn", onclick: () => openSetup(id, null, null, setup.promptTarget) }, "Try again"));
        return;
      }
    }
    if (!drawer || drawer.kind !== "setup" || drawer.id !== id) return;
    if (HOSTED && data.platforms.find((p) => p.id === setup.guide.platform)?.connects !== "mcp") {
      setup.guide = Object.assign({}, setup.guide, { steps: setup.guide.steps.map((step, index) => index === 0 ? { title: step.title, text: step.text } : step) });
    }
    renderSetup();
  }
  function copyBox(value, label = "Copy") {
    const btn = el("button", { class: "btn small quiet", onclick: async () => {
      try {
        if (!await copy(value)) throw new Error("Clipboard unavailable");
        btn.textContent = "Copied"; setTimeout(() => (btn.textContent = label), 2000);
      } catch { toast("Copy did not work. Select the text and copy it manually."); }
    } }, label);
    return el("div", { class: "copybox" }, el("pre", {}, value), btn);
  }
  function setupPrompts(g) {
    const prompts = g.prompts && g.prompts.length ? g.prompts : [{ target: g.platform, label: g.title, text: "Paste this once in the assistant you connected.", copy: g.collaborationPrompt }];
    const defaultTarget = g.platform === "dot" ? "dot" : "chatgpt";
    const selected = prompts.find((p) => p.target === (drawer.promptTarget || defaultTarget)) || prompts[0];
    drawer.promptTarget = selected.target;
    const content = el("div", { id: "setup-prompt-content" });
    const renderPrompt = (prompt) => content.replaceChildren(
      el("p", { class: "help" }, prompt.text),
      copyBox(prompt.copy, "Copy introduction"));
    const choice = el("select", { id: "setup-prompt-target", onchange: () => {
      const prompt = prompts.find((p) => p.target === choice.value);
      if (!prompt) return;
      drawer.promptTarget = prompt.target;
      renderPrompt(prompt);
    } }, prompts.map((p) => el("option", { value: p.target, selected: p.target === selected.target ? true : null }, p.label)));
    renderPrompt(selected);
    return el("section", { class: "setup-prompts" },
      el("h3", {}, "Introduce Hitchhike"),
      el("p", { class: "help" }, "This introduction explains how the assistant can help and includes your selected background request. A saved schedule and an actual run have separate status."),
      prompts.length > 1 ? el("details", { class: "more" }, el("summary", {}, "Using another OpenAI surface?"),
        el("p", { class: "help" }, "ChatGPT and Dots share plugin settings and one authenticated connection. Give any scheduling request to the client that will own that schedule."),
        el("label", { class: "field" }, el("span", {}, "Use this connection in"), choice)) : null,
      content);
  }
  function renderSetup() {
    const g = drawer.guide;
    const a = agentById(drawer.id);
    const mcp = (a ? platformOf(a).connects : data.platforms.find((p) => p.id === g.platform)?.connects) === "mcp";
    const pairing = HOSTED && !mcp ? currentPairing(drawer.id) : null;
    drawer.pairingExpiry = pairing ? pairing.expires_at : null;
    const k = [
      el("div", { class: "setup-heading" }, platformIcon(g.platform), el("div", {}, el("p", { class: "help" }, "Finish setup in your app"), el("h2", {}, g.title))),
      el("p", { class: "help" }, g.summary),
      el("div", { class: "connect-status setup-state", id: "setup-status", role: "status", "aria-live": "polite" }),
      el("ol", { class: "guide-steps" }, g.steps.map((step, index) => ({ step, index })).filter(({ step }) => !["Confirm access", "Confirm this connection", "Receive a task", "Send tasks and get results", "Prove the exchange", "Add background checks when ready"].includes(step.title)).map(({ step, index }) => {
        const pairingStep = HOSTED && !mcp && index === 0;
        const instruction = pairingStep ? (pairing ? pairing.instructions : null) : step.copy;
        const snippet = instruction ? copyBox(instruction) : null;
        return el("li", { class: "guide-step" },
          el("h3", { class: "setup-step-title" }, step.title || "Continue setup"),
          el("p", {}, pairingStep && !pairing ? "Create a new one-use code, then paste its instructions into your agent. An earlier code cannot be recovered from the relay." : step.text),
          snippet && (!HOSTED || !mcp)
            ? el("details", { class: "setup-copy" }, el("summary", {}, HOSTED ? "Show pairing instructions" : "Show private setup instructions"), snippet)
            : snippet,
          pairingStep ? el("div", {},
            pairing ? el("p", { class: "help", id: "pairing-expiry" }, "Expires " + new Date(pairing.expires_at).toLocaleString() + ". One use; kept only in this tab until expiry.") : null,
            el("button", { class: "btn quiet small", id: "new-pairing-code", disabled: pairingInFlight.has(drawer.id), onclick: () => newPairingCode(a ? a.id : drawer.id) }, "New pairing code"),
            el("p", { class: "help" }, "A new code replaces any unused pairing code. Existing connection credentials keep working.")) : null);
      })),
    ];
    if (mcp && (g.collaborationPrompt || (g.prompts && g.prompts.length))) k.push(setupPrompts(g));
    if (g.backgroundGuide) k.push(el("p", { class: "help" }, g.backgroundGuide.summary));
    const diagnostics = [];
    if (g.accessPrompt) diagnostics.push(el("p", { class: "help" }, "If the connection does not respond, use this optional read-only access check."), copyBox(g.accessPrompt, "Copy access check"));
    if (a && a.can_work) diagnostics.push(el("section", { class: "setup-check" },
      el("h3", {}, "Try a test request"),
      el("p", { class: "help" }, "This optional test creates a small task to check pickup and its returned result. You can continue using Hitchhike without running it."),
      el("button", { class: "btn", id: "setup-test-button", onclick: () => {
        const current = agentById(a.id);
        if (!current) return;
        const test = testJob(current);
        if (test && (OPEN.has(test.status) || test.status === "completed")) openJob(test.id);
        else runTest(a.id);
      } }, "Send a test")));
    if (diagnostics.length) k.push(el("details", { class: "more setup-optional", id: "setup-diagnostics" }, el("summary", {}, "Troubleshoot or try a test"), ...diagnostics));
    body().replaceChildren(...k);
    updateSetupStatus();
  }
  function updateSetupStatus() {
    const box = $("#setup-status");
    if (!box || !drawer || drawer.kind !== "setup") return;
    if (drawer.pairingExpiry && !currentPairing(drawer.id)) { renderSetup(); return; }
    const a = agentById(drawer.id);
    if (!a) return;
    const test = testJob(a);
    const verified = verifiedTest(a);
    let title = "Waiting for first check-in";
    let description = "Finish the steps below in " + a.name + ".";
    let state = "waiting";
    if (verified) {
      title = "Test response verified"; description = "The agent picked up the test and returned the expected result."; state = "verified";
    } else if (test && OPEN.has(test.status)) {
      state = "testing";
      title = test.status === "needs_approval" ? "Test needs approval" : test.status === "input_required" ? "Test needs your input" : test.status === "claimed" ? "Agent is running the test" : "Test is waiting for pickup";
      description = test.status === "needs_approval" ? "Open the test to approve it before the agent can pick it up." : test.status === "input_required" ? "Open the test to answer the agent’s question." : pickupText(a);
    } else if (test && test.status === "completed") {
      title = "Review the test result"; description = "A result came back, but its response has not been verified."; state = "review";
    } else if (test && ["failed", "expired", "canceled"].includes(test.status)) {
      title = "The last test did not finish"; description = "Check the setup in your app, then try the test again."; state = "review";
    } else if (a.last_seen_at) {
      title = "App checked in"; description = "The app reached Hitchhike. Task results and completed background runs are tracked separately."; state = "contact";
    }
    const signature = [state, title, description].join("|");
    if (box.dataset.signature !== signature) {
      box.dataset.signature = signature;
      box.dataset.state = state;
      box.replaceChildren(lamp(a), el("div", {}, el("strong", { class: "setup-status-title" }, title), el("span", { class: "setup-status-description" }, description)));
    }
    const button = $("#setup-test-button");
    if (button) {
      button.textContent = test && OPEN.has(test.status) ? "Open test" : test && test.status === "completed" ? (verified ? "View verified result" : "Review test result") : test ? "Try test again" : "Send a test";
      button.disabled = testsInFlight.has(a.id);
    }
  }

  // Compose -----------------------------------------------------------
  function openCompose(preselect) {
    const only = workers().length === 1 ? workers()[0].id : null;
    drawer = { kind: "compose", sel: new Set(preselect ? [preselect] : only ? [only] : []), type: "task", attempt: crypto.randomUUID(), sent: new Map() };
    renderCompose();
    openDrawer();
  }
  function workers() { return data.agents.filter((a) => a.can_work); }
  function allowedTypes() {
    const ws = drawer.sel.has("*") ? workers() : workers().filter((w) => drawer.sel.has(w.id));
    if (!ws.length) return new Set(Object.keys(TYPE_LABEL));
    if (drawer.sel.has("*")) return new Set(ws.flatMap((w) => w.work_types));
    return new Set(Object.keys(TYPE_LABEL).filter((t) => ws.every((w) => w.work_types.includes(t))));
  }
  function renderCompose() {
    const ws = workers();
    if (!ws.length) {
      body().replaceChildren(el("h2", {}, "Send a task"), el("p", {}, "No agent can take jobs yet. Connect one that does the work, like Grok Bot or Muse."), el("button", { class: "btn", onclick: () => { closeDrawer(); openConnect(); } }, "Connect an agent"));
      return;
    }
    const picks = el("div", { class: "picks" }, ws.map((w) => el("label", { class: "pick" },
      el("input", { type: "checkbox", value: w.id, checked: drawer.sel.has(w.id), onchange: (e) => { drawer.sel.delete("*"); e.target.checked ? drawer.sel.add(w.id) : drawer.sel.delete(w.id); syncCompose(); } }),
      lamp(w), el("span", { class: "pick-name" }, w.name),
      el("span", { class: "pick-sub" }, (w.work_types.includes("task") ? "Receives general tasks" : typeWords(w.work_types)) + ". " + cadence(w).replace(/^./, (c) => c.toUpperCase()) + "."))),
      el("label", { class: "pick" },
        el("input", { type: "checkbox", value: "*", checked: drawer.sel.has("*"), onchange: (e) => { drawer.sel.clear(); if (e.target.checked) drawer.sel.add("*"); syncCompose(); } }),
        el("span", {}), el("span", { class: "pick-name" }, "Whoever checks in first"),
        el("span", { class: "pick-sub" }, "Any agent that takes this kind of job.")));
    const k = [
      el("h2", {}, "Send a task"),
      el("fieldset", { class: "field" }, el("legend", {}, "Who should do it?"), picks, el("small", {}, "Pick more than one to compare their answers."), el("p", { class: "warning", id: "c-note", hidden: true, style: "margin:6px 0 0" })),
      el("label", { class: "field" }, el("span", {}, "What do you need?"), el("textarea", { id: "c-task", rows: "5", placeholder: TYPE_HINT.task })),
      el("details", { class: "more" }, el("summary", {}, "Context and options"),
        el("label", { class: "field" }, el("span", {}, "Relevant context"), el("textarea", { id: "c-context", rows: "3", placeholder: "Facts, prior decisions, current progress, and accessible links. Other apps do not automatically share your chat or files." })),
        el("label", { class: "field" }, el("span", {}, "Constraints"), el("textarea", { id: "c-constraints", rows: "2", placeholder: "One per line, e.g. Use the attached plan; do not publish yet" })),
        el("fieldset", { class: "field" }, el("legend", {}, "Task guidance"), el("div", { class: "chips", id: "c-types" })),
        el("label", { class: "field" }, el("span", {}, "Title"), el("input", { id: "c-title", type: "text", placeholder: "Made from the first line if you leave it blank" })),
        el("label", { class: "field" }, el("span", {}, "Done when"), el("textarea", { id: "c-done", rows: "3", placeholder: "One per line, e.g. Every claim has a source link" })),
        el("label", { class: "field" }, el("span", {}, "Give up after"), el("select", { id: "c-expire" }, GIVE_UP.map(([m, l]) => el("option", { value: String(m) }, l))))),
      el("p", { class: "error", id: "c-error", role: "alert", hidden: true }),
      el("div", { class: "actions" }, el("button", { class: "btn", id: "c-send", onclick: sendJob }, "Send")),
    ];
    body().replaceChildren(...k);
    syncCompose();
  }
  function syncCompose() {
    $$(".picks input", body()).forEach((input) => { input.checked = drawer.sel.has(input.value); });
    const allowed = allowedTypes();
    if (!drawer.type || !allowed.has(drawer.type)) drawer.type = ["task", "research", "summarize", "monitor", "digest", "review", "build"].find((t) => allowed.has(t)) || null;
    $("#c-types").replaceChildren(...Object.keys(TYPE_LABEL).map((t) => el("label", { class: "chip" },
      el("input", { type: "radio", name: "c-type", value: t, checked: drawer.type === t, disabled: !allowed.has(t), onchange: () => { drawer.type = t; syncCompose(); } }),
      el("span", {}, TYPE_LABEL[t]))));
    const task = $("#c-task");
    if (task && drawer.type) task.placeholder = TYPE_HINT[drawer.type];
    const notes = (drawer.sel.has("*") ? [] : [...drawer.sel].map(agentById)).filter(Boolean).map((a) => {
      if (cadence(a) === "On demand") return a.name + " only picks up jobs when you ask it to check, so this waits until you do.";
      if (a.poll_minutes >= 60) return a.name + " has a saved check interval of " + pollLabel(a.poll_minutes) + ". Confirm its recurring task is running; pickup could take a while.";
      return null;
    }).filter(Boolean);
    const note = $("#c-note");
    note.hidden = !notes.length;
    note.textContent = notes.join(" ");
    const n = drawer.sel.has("*") ? 1 : drawer.sel.size;
    const btn = $("#c-send");
    const names = drawer.sel.has("*") ? "whoever checks in first" : [...drawer.sel].map(who).join(" and ");
    btn.textContent = !n ? "Pick who should do it" : n > 2 ? "Send to " + n + " agents" : "Send to " + names;
    btn.disabled = !n || !drawer.type;
  }
  async function sendJob() {
    const err = $("#c-error");
    err.hidden = true;
    const task = $("#c-task").value.trim();
    if (!task) { err.hidden = false; err.textContent = "Describe what you need first."; $("#c-task").focus(); return; }
    const title = $("#c-title").value.trim() || deriveTitle(task);
    const done = $("#c-done").value.split("\n").map((s) => s.trim()).filter(Boolean);
    const expire = Number($("#c-expire").value);
    const targets = drawer.sel.has("*") ? ["*"] : [...drawer.sel];
    const btn = $("#c-send");
    btn.disabled = true;
    const compose = drawer;
    const requestType = compose.type;
    const context = $("#c-context").value.trim();
    const constraints = $("#c-constraints").value.split("\n").map((x) => x.trim()).filter(Boolean);
    const fingerprint = JSON.stringify([compose.type, targets, title, task, context, constraints, done, expire]);
    if (compose.fingerprint && compose.fingerprint !== fingerprint) {
      err.hidden = false; err.textContent = "This attempt may already have reached a receiver. Retry the same task, or close this and start a new one."; btn.disabled = false; return;
    }
    compose.fingerprint = fingerprint;
    const sent = [];
    try {
      for (const to of targets) {
        if (compose.sent.has(to)) { sent.push(compose.sent.get(to)); continue; }
        const payload = { type: requestType, to, title, goal: task, idempotency_key: "dashboard:" + compose.attempt + ":" + to };
        if (context) payload.inputs = { context };
        if (constraints.length) payload.constraints = constraints;
        if (done.length) payload.acceptance = done;
        if (expire !== 4320) payload.expires_in_minutes = expire;
        const job = (await api("/v1/jobs", { method: "POST", body: payload })).job;
        compose.sent.set(to, job); sent.push(job);
      }
    } catch (e) {
      if (e.code === "auth") return;
      const definiteRejection = e.status >= 400 && e.status < 500 && e.status !== 408;
      if (!definiteRejection) compose.uncertain = true;
      if (!compose.sent.size && !compose.uncertain && definiteRejection) {
        compose.fingerprint = null; compose.attempt = crypto.randomUUID();
      }
      err.hidden = false; err.textContent = e.message + (compose.sent.size ? " " + compose.sent.size + " already sent. Retry to finish sending; existing tasks will not be duplicated." : compose.fingerprint ? " Retry uses the same task identifier." : " You can correct the task and try again."); btn.disabled = false;
      await load(false).catch(onLoadError); return;
    }
    await load(false).catch(onLoadError);
    if (drawer !== compose) return;
    drawer = { kind: "sent" };
    const k = [el("h2", {}, sent.length > 1 ? "Sent to " + sent.length + " agents" : "Sent")];
    k.push(el("div", { class: "sent" }, sent.map((j) => el("p", {}, j.status === "needs_approval" ? "“" + j.title + "” is waiting for your approval before anyone can pick it up." : pickupText(j.to === "*" ? null : agentById(j.to))))));
    k.push(el("p", { class: "help", style: "margin-top:12px" }, "The result will appear under Tasks. Ask your sending assistant to retrieve it when you return to that conversation."));
    k.push(el("div", { class: "actions" },
      sent.length === 1 ? el("button", { class: "btn", onclick: () => openJob(sent[0].id) }, "Open task") : null,
      el("button", { class: "btn quiet", onclick: () => openCompose() }, "Send another")));
    body().replaceChildren(...k);
  }

  // Connection checks and workspace controls --------------------------
  function testJob(a) { return data.jobs.find((j) => j.to === a.id && j.inputs && j.inputs.connection_test); }
  function verifiedTest(a) {
    const j = testJob(a);
    if (!j || j.status !== "completed" || !j.result || !j.result.validation || !j.result.validation.ok) return false;
    const expected = j.inputs.expected_response;
    return !!expected && (j.result.summary === expected || (j.result.body || "").trim() === expected);
  }
  function readiness(a) {
    const j = testJob(a);
    if (verifiedTest(a)) return "Round trip verified. A test was picked up and its expected result returned.";
    if (j && OPEN.has(j.status)) return "Test in progress. " + pickupText(a);
    if (j && j.status === "completed") return "A test result returned. Open it to review the response; this connection has not been verified yet.";
    if (j && (j.status === "failed" || j.status === "expired")) return "The last test did not complete. Check the app's setup and try again.";
    return a.last_seen_at ? "Authenticated request seen. Confirm tool access, then test task pickup and results." : "Awaiting first contact. Follow the setup instructions in your app.";
  }
  const testAttempts = new Map();
  const testsInFlight = new Set();
  async function runTest(id) {
    const agent = agentById(id);
    const existing = agent && testJob(agent);
    if (existing && OPEN.has(existing.status)) { openJob(existing.id); return; }
    if (testsInFlight.has(id)) return;
    testsInFlight.add(id);
    if (!testAttempts.has(id)) testAttempts.set(id, "test:" + crypto.randomUUID());
    try {
      const out = await api("/v1/admin/agents/" + encodeURIComponent(id) + "/test", { method: "POST", body: {}, idempotencyKey: testAttempts.get(id) });
      testAttempts.delete(id);
      await load(false); openJob(out.job.id);
      toast("Test sent. Ask an on-demand app to check its tasks.");
    } catch (e) { if (e.code !== "auth") toast(e.message); }
    finally { testsInFlight.delete(id); }
  }
  async function openWorkspace() {
    drawer = { kind: "workspace" }; openDrawer();
    body().replaceChildren(el("h2", {}, "Workspace settings"), el("p", { class: "muted" }, "Loading…"));
    let settings;
    try { settings = await api("/v1/admin/workspace"); }
    catch (e) { if (drawer && drawer.kind === "workspace") body().replaceChildren(el("h2", {}, "Workspace settings"), el("p", { class: "error" }, e.message)); return; }
    if (!drawer || drawer.kind !== "workspace") return;
    const w = settings.workspace, usage = settings.usage || {}, limits = settings.limits || {};
    const paused = el("input", { type: "checkbox", checked: w.paused });
    const retention = el("input", { type: "number", min: "1", max: "30", value: String(w.retention_days || 30) });
    const error = el("p", { class: "error", role: "alert", hidden: true });
    const rows = [["Connections", "connections"], ["Background workers", "polling_workers"], ["Handoffs this month", "jobs_month"], ["Handoffs today", "jobs_day"], ["Open tasks", "open_jobs"]];
    body().replaceChildren(
      el("h2", {}, w.name || "Your workspace"),
      session && session.user ? el("p", { class: "muted" }, session.user.email) : null,
      el("h3", {}, "Usage"),
      el("dl", { class: "usage-list" }, rows.map(([label, key]) => el("div", { class: "usage-row" }, el("dt", {}, label), el("dd", {}, String(usage[key] ?? 0) + (limits[key] != null && (HOSTED || limits[key] !== 2147483647) ? " / " + limits[key] : ""))))),
      el("p", { class: "help" }, "Stored task data: " + ((usage.storage_bytes || 0) / 1048576).toFixed(1) + " MB" + (limits.storage_bytes != null && (HOSTED || limits.storage_bytes !== Number.MAX_SAFE_INTEGER) ? " / " + (limits.storage_bytes / 1048576).toFixed(0) + " MB" : "")),
      el("h3", {}, "Task intake"),
      el("label", { class: "check" }, paused, el("span", {}, el("b", {}, "Pause task activity"), el("small", {}, "New tasks and incoming results are blocked until you resume. Existing results stay available. Work already running in other apps may continue."))),
      el("h3", {}, "History"),
      el("label", { class: "field" }, el("span", {}, "Keep task history for this many days"), retention, el("small", {}, "Expired history is removed by scheduled cleanup. Shortening retention can permanently remove older tasks.")),
      error,
      el("div", { class: "actions" }, el("button", { class: "btn", onclick: async () => {
        error.hidden = true;
        const days = Number(retention.value);
        if (!Number.isInteger(days) || days < 1 || days > 30) { error.hidden = false; error.textContent = "Choose between 1 and 30 days."; return; }
        if (days < w.retention_days && !confirm("Shorten retention to " + days + " days? Older history will be permanently removed during cleanup.")) return;
        try { await api("/v1/admin/workspace", { method: "PATCH", body: { paused: paused.checked, retention_days: days } }); toast("Workspace settings saved."); openWorkspace(); }
        catch (e) { if (e.code !== "auth") { error.hidden = false; error.textContent = e.message; } }
      } }, "Save settings")),
      el("h3", {}, "Export"),
      el("p", { class: "help" }, "Download your task history, results, and connection settings. Connection credentials are excluded."),
      el("button", { class: "btn quiet", onclick: async () => {
        try {
          const exported = await api("/v1/admin/export");
          const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }));
          const link = el("a", { href: url, download: HOSTED ? "hitchhike-export.json" : "relay-export.json" }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast("Export ready. Check your browser’s downloads.");
        } catch (e) { if (e.code !== "auth") toast(e.message); }
      } }, "Export workspace"),
      el("h3", {}, "Delete workspace"),
      el("p", { class: "help" }, (HOSTED ? "Permanently remove this workspace's active data and revoke its connections." : "Reset this relay's workspace by permanently removing its active data and connections. The relay will be ready for new connections after cleanup.") + " Existing provider conversations are not deleted. Provider-managed database backups may retain copies until their recovery window expires."),
      el("button", { class: "btn quiet", onclick: async () => {
        if (prompt("This permanently deletes the workspace, tasks, results, and connections. Type DELETE to continue.") !== "DELETE") return;
        try {
          await api("/v1/admin/workspace", { method: "DELETE", body: { confirmation: "DELETE" } });
          if (HOSTED) await finishSignOut("Workspace deleted.");
          else { pairingCodes.clear(); closeDrawer(); await load(false); toast("Workspace reset. You can connect agents again."); }
        }
        catch (e) { if (e.code !== "auth") toast(e.message); }
      } }, "Delete workspace"));
  }
  $("#workspace-settings").addEventListener("click", openWorkspace);

  // Help --------------------------------------------------------------
  function openHelp() {
    drawer = { kind: "help" };
    body().replaceChildren(
      el("h2", {}, "How it works"),
      el("p", {}, "Your apps use this workspace to send tasks with context and return results. Each assistant works with its own tools and allowance. You can keep working in the app you prefer."),
      el("div", { class: "actions" }, el("button", { class: "btn quiet", onclick: () => { showSetup = true; store.del(startKey()); closeDrawer(); renderStart(); $("#start-continue").focus(); } }, "Show setup guide")),
      el("h3", {}, "When work starts"),
      el("p", {}, "On-demand connections act when you ask them to check. A saved interval here does not start or verify a recurring check in the provider. Hitchhike's scheduled jobs only add work to the queue; the receiving agent still has to check in. " + (HOSTED ? "Hosted webhook wake-ups are disabled." : "A configured wake-up trigger can request a run from a supported provider; it does not guarantee pickup.")),
      el("h3", {}, "Context and permissions"),
      el("p", {}, "Only the context included in a task is handed over. Chat history, local files, and private links are not automatically available to another app. Give each connection permission to send, receive, or both. Your provider's existing tool and approval controls still apply."),
      el("h3", {}, "Who sees the task"),
      el("p", {}, HOSTED ? "This hosted service stores task content to deliver it. Its operator can access stored content, and the connected AI providers receive the tasks you send them. This is not end-to-end encrypted. Review each provider's data policy before sending sensitive information." : "The operator of this relay and the connected AI providers can access the tasks routed through them. Review their data policies before sending sensitive information."),
      el("h3", {}, "Results and history"),
      el("p", {}, "A result can be ready here before the original conversation retrieves it. Validation checks structure; it does not verify facts or completed actions. Review important results. Workspace settings include export, retention, and deletion controls."),
      el("h3", {}, "Compatibility"),
      el("p", {}, "ChatGPT and Dots (OpenAI) can use one Hitchhike plugin connection. Open its setup to copy a prompt for either app or both, then check the authorized connection ID. Coding agents and supported chat apps can use MCP; Muse, Grok Bot, and other HTTP workers use pairing. Test a manual round trip, then verify any provider schedule separately. App availability and permissions vary."));
    openDrawer();
  }
  $("#help").addEventListener("click", openHelp);

  // ------------------------------------------------------------ connect
  const dialog = $("#connect-dialog");
  const cbody = () => $("#connect-body");
  $("#connect-close").addEventListener("click", () => dialog.close());
  function openConnect(platformId) {
    if (platformId) renderConnectForm(data.platforms.find((p) => p.id === platformId));
    else renderPlatformGrid();
    if (!dialog.open) dialog.showModal();
  }
  function renderPlatformGrid() {
    const chats = new Set(["dot", "chatgpt", "claude", "muse", "grok-bot", "grok"]);
    const groups = [
      ["Chat assistants", data.platforms.filter((p) => chats.has(p.id))],
      ["Coding agents", data.platforms.filter((p) => p.work === "local")],
      ["Other agents", data.platforms.filter((p) => !chats.has(p.id) && p.work !== "local")],
    ];
    cbody().replaceChildren(
      el("h2", {}, "Choose an agent"),
      el("p", { class: "muted" }, "Add an app you already use. We’ll walk you through connecting it."),
      ...groups.filter(([, platforms]) => platforms.length).map(([label, platforms]) => el("section", { class: "platform-group" },
        el("h3", { class: "platform-group-label" }, label),
        el("div", { class: "tiles" }, platforms.map((p) => el("button", { class: "tile", type: "button", onclick: () => renderConnectForm(p) },
          platformIcon(p.id), el("span", { class: "tile-name" }, p.label), el("span", { class: "tile-blurb" }, p.blurb)))))),
      el("div", { class: "dialog-actions" }, el("button", { class: "btn quiet", type: "button", onclick: () => dialog.close() }, "Cancel")));
  }
  // The settings shared by "Connect" and "Edit settings". agent is null when connecting a new one.
  let formSeq = 0;
  function settingsForm(p, agent) {
    const cur = agent || {
      name: data.agents.some((a) => a.name === p.label) ? p.label + " 2" : p.label,
      can_work: p.defaults.can_work, can_request: p.defaults.can_request, work_types: p.defaults.work_types,
      poll_minutes: p.defaults.poll_minutes, max_leases: 1, daily_work_limit: 50, accept_from: ["*"],
    };
    const nodes = [];
    const name = el("input", { type: "text", value: cur.name, required: true, maxlength: "60" });
    nodes.push(el("label", { class: "field" }, el("span", {}, "Name in your workspace"), name));
    const receives = el("input", { type: "checkbox", checked: !!cur.can_work });
    const sends = el("input", { type: "checkbox", checked: !!cur.can_request });
    nodes.push(el("fieldset", { class: "field permission-options" }, el("legend", {}, "What can it do?"),
      el("label", { class: "check permission-option" }, sends, el("span", {}, el("b", {}, "Send tasks"), el("small", {}, "Ask your other agents for help and get their results."))),
      el("label", { class: "check permission-option" }, receives, el("span", {}, el("b", {}, "Receive tasks"), el("small", {}, "Do work with the tools and permissions it already has.")))));
    const typeBoxes = Object.keys(TYPE_LABEL).map((t) => el("label", { class: "check" },
      el("input", { type: "checkbox", value: t, checked: !agent || cur.work_types.includes(t) }), el("span", {}, TYPE_LABEL[t])));
    const options = [["", "On demand"]];
    if (p.schedule) for (const [m, l] of POLL) if (m >= p.schedule.min) options.push([String(m), "Every " + l]);
    const current = cur.poll_minutes == null ? "" : String(cur.poll_minutes);
    if (!options.some(([v]) => v === current)) options.push([current, "Every " + current + " minutes"]);
    const poll = el("select", { "aria-label": "Check for tasks" }, options.map(([v, l]) => el("option", { value: v, selected: v === current ? true : null }, l)));
    const group = "from-" + ++formSeq;
    const senders = data.agents.filter((a) => a.can_request && (!agent || a.id !== agent.id));
    const restricted = !cur.accept_from.includes("*");
    const fromAnyone = el("input", { type: "radio", name: group, checked: !restricted });
    const fromSome = el("input", { type: "radio", name: group, checked: restricted });
    const fromBoxes = senders.map((a) => el("label", { class: "check" }, el("input", { type: "checkbox", value: a.id, checked: !restricted || cur.accept_from.includes(a.id) }), el("span", {}, a.name)));
    const atOnce = el("input", { type: "number", min: "1", max: "10", value: String(cur.max_leases || 1), style: "width:96px" });
    const limit = el("input", { type: "number", min: "1", max: "10000", value: String(cur.daily_work_limit || 50), style: "width:96px" });
    nodes.push(el("details", { class: "more" }, el("summary", {}, "Schedule and advanced settings"),
      el("div", { class: "field" }, el("span", {}, "Check for tasks"), poll, el("small", {}, "Save an interval only after configuring it in your app. These choices do not guarantee provider support or create a recurring task. Check the app's supported cadence and run history; checks consume its allowance.")),
      el("fieldset", { class: "field" }, el("legend", {}, "Accepted task guidance"), el("div", { class: "type-grid" }, typeBoxes)),
      el("fieldset", { class: "field" }, el("legend", {}, "Who can send it jobs?"),
        el("label", { class: "check" }, fromAnyone, el("span", {}, "You and any agent on this relay")),
        senders.length ? el("label", { class: "check" }, fromSome, el("span", {}, "You and only these agents:")) : null,
        senders.length ? el("div", { style: "padding-left:24px" }, fromBoxes) : null),
      el("div", { class: "field" }, el("span", {}, "Jobs it works on at once"), atOnce,
        el("small", {}, "Different agents always work at the same time. This is about one agent: most do one job at a time and pick up the next right after. Raise it only if you've set up more than one routine or bot for it.")),
      el("div", { class: "field" }, el("span", {}, "Most jobs it takes per day"), limit)));
    const read = () => {
      const types = typeBoxes.map((l) => l.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
      return {
        name: name.value.trim(),
        can_work: receives.checked,
        work_types: receives.checked ? (types.length ? types : ["task"]) : [],
        can_request: sends.checked,
        poll_minutes: !receives.checked || poll.value === "" ? null : Number(poll.value),
        max_leases: Math.max(1, Math.min(10, Number(atOnce.value) || 1)),
        daily_work_limit: Math.max(1, Math.min(10000, Number(limit.value) || 50)),
        accept_from: fromSome.checked ? fromBoxes.map((l) => l.querySelector("input")).filter((i) => i.checked).map((i) => i.value) : ["*"],
      };
    };
    return { nodes, name, read };
  }

  function connectBlurb(p) {
    if (HOSTED && (p.id === "dot" || p.id === "chatgpt")) return "One Hitchhike plugin connection can be used in ChatGPT, Dots, or both. Next, select the plugin and give the assistant one introduction, including your selected background request.";
    if (p.id === "dot") return "Self-hosted use requires a compatible custom MCP app. Dots access to this private relay is unverified; confirm its tools before using it.";
    return p.connects === "mcp" ? "Next, add Hitchhike in " + p.label + " and authorize this connection." : "Next, paste " + (HOSTED ? "a one-use pairing instruction" : "the setup instructions") + " into " + p.label + ".";
  }

  function renderSharedConnections(p, connections) {
    cbody().replaceChildren(
      el("div", { class: "connect-heading" }, platformIcon(p.id), el("h2", {}, "Use your existing connection")),
      el("p", { class: "muted" }, "ChatGPT and Dots share plugin settings. Use an existing Hitchhike connection and copy a prompt for either app or both. The prompt checks which connection the plugin is actually using."),
      el("div", { class: "shared-connections" }, connections.map((a) => el("section", { class: "shared-connection" },
        el("strong", {}, a.name), el("p", { class: "help" }, a.id),
        el("p", { class: "help" }, a.last_seen_at ? "An authenticated request has been seen. Verify access with the setup prompt." : "Awaiting first contact. You can continue setup without creating another connection."),
        el("button", { class: "btn", type: "button", onclick: () => { dialog.close(); return openSetup(a.id, null, null, p.id); } }, "Use " + a.name)))),
      el("details", { class: "more" }, el("summary", {}, "Need a separate connection?"),
        el("p", { class: "help" }, "Separate records do not establish separate OpenAI authorizations. Independently scoped simultaneous ChatGPT and Dots connections are unverified. Reconnecting the shared plugin can affect both apps."),
        el("button", { class: "btn quiet", type: "button", onclick: () => renderConnectForm(p, true) }, "Create a separate connection")),
      el("div", { class: "dialog-actions" }, el("button", { class: "btn quiet", type: "button", onclick: renderPlatformGrid }, "Back")));
  }

  function renderConnectForm(p, separate = false) {
    const shared = HOSTED && (p.id === "dot" || p.id === "chatgpt")
      ? data.agents.filter((a) => a.platform === "dot" || a.platform === "chatgpt").sort((a, b) => Number(!!b.last_seen_at) - Number(!!a.last_seen_at)) : [];
    if (shared.length && !separate) { renderSharedConnections(p, shared); return; }
    const form = settingsForm(p, null);
    const error = el("p", { class: "error", role: "alert", hidden: true });
    const connectButton = el("button", { class: "btn", type: "button", onclick: submit }, "Get setup instructions");
    cbody().replaceChildren(
      el("div", { class: "connect-heading" }, platformIcon(p.id), el("h2", {}, "Connect " + p.label)),
      el("p", { class: "muted" }, separate ? "This creates another Hitchhike record. Independently scoped ChatGPT and Dots authorizations are unverified; reconnecting the shared plugin can affect both apps." : connectBlurb(p)),
      ...form.nodes,
      error,
      el("div", { class: "dialog-actions" },
        el("button", { class: "btn quiet", type: "button", onclick: renderPlatformGrid }, "Back"),
        connectButton));
    form.name.focus();
    form.name.select();
    let submitting = false;
    let savedConnection = null;
    let attemptedPayload = null;
    function allowChanges() {
      attemptedPayload = null;
      cbody().querySelectorAll("input,select").forEach((input) => { input.disabled = false; });
    }
    async function submit() {
      if (submitting) return;
      error.hidden = true;
      const s = form.read();
      if (!s.name) { error.hidden = false; error.textContent = "Give it a name."; form.name.focus(); return; }
      if (!s.can_work && !s.can_request) { error.hidden = false; error.textContent = "Allow this connection to send tasks, receive tasks, or both."; return; }
      submitting = true;
      connectButton.disabled = true;
      const epoch = sessionEpoch;
      const payload = attemptedPayload || Object.assign({ id: uniqueHandle(s.name), platform: p.id }, s);
      attemptedPayload = payload;
      cbody().querySelectorAll("input,select").forEach((input) => { input.disabled = true; });
      try {
        const out = savedConnection || await api("/v1/admin/agents", { method: "POST", body: payload, keepSession: true });
        if (epoch !== sessionEpoch) return;
        savedConnection = out;
        if (out.guide) rememberPairing(out.agent.id, out.guide, out.pairing);
        await load(false);
        if (epoch !== sessionEpoch || !connectButton.isConnected || !dialog.open) return;
        dialog.close();
        openSetup(out.agent.id, out.guide, out.pairing);
      } catch (e) {
        if (epoch !== sessionEpoch || !connectButton.isConnected) return;
        error.hidden = false;
        if (savedConnection) {
          error.textContent = "Connection saved. Refreshing the workspace was interrupted. Continue setup to reopen it without creating another connection.";
          connectButton.textContent = "Continue setup";
        } else if (e.code === "handle_taken") {
          try {
            await load(false);
            if (epoch !== sessionEpoch || !connectButton.isConnected) return;
            const existing = data.agents.find((a) => (a.handle || a.id) === payload.id);
            if (existing) {
              savedConnection = { agent: existing };
              error.textContent = "A connection with this handle already exists. Review its setup before adding another; it may be from an interrupted attempt.";
              connectButton.textContent = "Review existing connection";
            } else {
              error.textContent = "Another connection took this handle. Choose another name or refresh your connections.";
              allowChanges();
            }
          }
          catch { error.textContent = "Another connection took this handle. Refresh your connections and reopen its setup before trying again."; }
        } else if (e.code === "invalid_request" || e.code === "connection_limit") {
          error.textContent = e.message;
          allowChanges();
        } else error.textContent = e.code === "auth" ? "Sign in again to continue." : e.message + " Retry to recover this attempt, or refresh your connections before starting again.";
      } finally { submitting = false; connectButton.disabled = false; }
    }
  }

  // Edit --------------------------------------------------------------
  function openEdit(id) {
    const a = agentById(id);
    if (!a) return;
    drawer = { kind: "edit", id };
    let p = platformOf(a);
    const platformSelect = el("select", { "aria-label": "Which agent it is" }, data.platforms.map((x) => el("option", { value: x.id, selected: x.id === p.id ? true : null }, x.label)));
    const slot = el("div", {});
    let form = settingsForm(p, a);
    const original = Object.assign({ platform: a.platform }, form.read());
    slot.replaceChildren(...form.nodes);
    platformSelect.addEventListener("change", () => {
      p = data.platforms.find((x) => x.id === platformSelect.value);
      form = settingsForm(p, Object.assign({}, a, form.read()));
      slot.replaceChildren(...form.nodes);
    });
    const error = el("p", { class: "error", role: "alert", hidden: true });
    body().replaceChildren(
      el("h2", {}, "Settings for " + a.name),
      el("p", { class: "help" }, HOSTED
        ? "Names and ordinary settings preserve authorization. Removing a permission applies immediately. Adding a permission absent from the app’s previous consent requires fresh authorization in that app; previously consented permissions can resume. Replace credentials only to revoke the current authorization and keys."
        : "Names and ordinary settings preserve the connection key. Permission changes apply immediately. Get a new key only when you need to replace its credentials."),
      el("label", { class: "field" }, el("span", {}, "Which agent is it?"), platformSelect),
      slot, error,
      el("div", { class: "actions" },
        el("button", { class: "btn", onclick: save }, "Save"),
        el("button", { class: "btn quiet", onclick: () => openAgent(id) }, "Cancel")));
    openDrawer();
    let saving = false;
    async function save() {
      if (saving) return;
      error.hidden = true;
      const s = form.read();
      if (!s.name) { error.hidden = false; error.textContent = "Give it a name."; return; }
      const changes = Object.fromEntries(Object.entries(Object.assign({ platform: p.id }, s)).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key])));
      if (!Object.keys(changes).length) { toast("No changes to save."); openAgent(id); return; }
      saving = true;
      try {
        await api("/v1/admin/agents", { method: "POST", body: Object.assign({ id }, changes) });
        await load(false);
        toast("Saved " + s.name + "’s settings." + (HOSTED && (changes.can_work === true || changes.can_request === true) ? " Added permissions may need fresh authorization in your app." : ""));
        openAgent(id);
      } catch (e) { if (e.code !== "auth") { error.hidden = false; error.textContent = e.message; } }
      finally { saving = false; }
    }
  }
  $("#connect").addEventListener("click", () => openConnect());
  $("#compose").addEventListener("click", () => openCompose());

  // ------------------------------------------------------------ boot
  async function boot() {
    if (HOSTED) {
      try {
        if (CLERK) {
          if (!window.AgentConnectAuth) throw new Error("Sign-in is not configured on this deployment yet.");
          const clerk = await window.AgentConnectAuth.ready;
          if (!clerk.session) { signOut(""); return; }
        }
        session = await api("/auth/session", { keepSession: true });
        if (!session.authenticated) { signOut(""); return; }
        csrfToken = session.csrfToken;
        const robots = $('meta[name="robots"]');
        if (robots) robots.setAttribute("content", "noindex");
      } catch (e) { signOut(CLERK ? (e.message || "Sign-in could not load. Reload to try again.") : "Could not check your session. Reload to try again."); return; }
    } else if (!token) { signOut(""); return; }
    try { await load(true); start(); }
    catch (e) { if (e.code !== "auth") { start(); onLoadError(e); } }
  }
  boot();
})();
`;

/** The claim link as a web page, for agents that can browse but can't send POST requests. */
export function formPage(title: string, brief: string, action: string, closed: string | null): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Job: ${esc(title)}</title>${FONTS}<style>${TOKENS}${PAGE_CSS}</style></head>
<body><main class="page">
<pre class="brief">${esc(brief)}</pre>
${
  closed
    ? `<p class="closed">${esc(closed)}</p>`
    : `<form method="post" action="${esc(action)}">
<label for="result"><strong>Your result</strong> (plain text or markdown)</label>
<textarea id="result" name="result" rows="16" required></textarea>
<button class="btn" type="submit">Submit result</button>
</form>`
}
</main></body></html>`;
}

export function messagePage(code: string, message: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(code)}</title>${FONTS}<style>${TOKENS}${PAGE_CSS}</style></head>
<body><main class="page"><h1>${esc(code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()))}</h1><p class="prose">${esc(message)}</p></main></body></html>`;
}

const PAGE_CSS = `
.page{max-width:760px;margin:0 auto;padding:28px 16px 60px;display:grid;gap:18px}
.page h1{font:600 26px/1.2 var(--cond);margin:0}
.brief{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 var(--mono);background:var(--panel);border:1px solid var(--rule);border-radius:8px;padding:16px;margin:0}
form{display:grid;gap:10px}
textarea{width:100%;border:1px solid var(--rule-strong);border-radius:6px;background:var(--panel);padding:10px;font:14px/1.5 var(--mono)}
.closed{color:var(--muted)}
.prose{white-space:pre-wrap;margin:0}
.btn{justify-self:start}
`;
