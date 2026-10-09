/** Public Clerk configuration only. Secrets never enter these HTML templates. */
import { safeAuthReturn, safeFrontendReturn } from "./auth-return";
export type ClerkUiConfig = {
  publishableKey: string;
  frontendApi: string;
  nonce?: string;
  returnTo: string;
  apiUrl?: string;
  signInPath?: string;
  returnFromQuery?: boolean;
  assets?: Record<string, string>;
};

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const nonceAttr = (input: ClerkUiConfig) => input.nonce ? ` nonce="${esc(input.nonce)}"` : "";

function publicConfig(input: ClerkUiConfig) {
  const origin = new URL(input.frontendApi.startsWith("https://") ? input.frontendApi : "https://" + input.frontendApi);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.port || origin.pathname !== "/" || origin.search || origin.hash || !/^[a-z0-9.-]+$/i.test(origin.hostname)) throw new Error("Invalid Clerk frontend API origin");
  // The auth backend also restricts return_to. Never let a UI helper become an open redirect.
  const returnTo = input.signInPath === "/sign-in"
    ? safeFrontendReturn(input.returnTo,"https://agent-connect.invalid")
    : safeAuthReturn(input.returnTo,"https://agent-connect.invalid");
  let apiUrl = "";
  if (input.apiUrl) {
    const api = new URL(input.apiUrl);
    if (api.protocol !== "https:" || api.username || api.password || api.pathname !== "/" || api.search || api.hash) throw new Error("Invalid API origin");
    apiUrl = api.origin;
  }
  const signInPath = input.signInPath === "/sign-in" ? "/sign-in" : "/auth/clerk/start";
  return { publishableKey: input.publishableKey, origin: origin.origin, nonce: input.nonce, returnTo, apiUrl, signInPath, returnFromQuery: input.returnFromQuery === true };
}

/** Loads on Clerk pages only. Token values are returned to callers, never persisted by the app. */
export function clerkBootstrap(input: ClerkUiConfig, withUi = false): string {
  const config = publicConfig(input);
  return `<script${nonceAttr(input)}>(function () {
  const config = ${json(config)};
  if (config.returnFromQuery) {
    const candidate = new URLSearchParams(location.search).get("return_to");
    if (candidate) {
      try {
        const target = new URL(candidate, location.origin);
        if (target.origin === location.origin && !target.username && !target.password && ["/app", "/app-next", "/connect"].includes(target.pathname)) {
          const allowed = ["response_type", "client_id", "redirect_uri", "state", "scope", "code_challenge", "code_challenge_method", "resource"];
          if (allowed.some(function(key) { return target.searchParams.getAll(key).length > 1; })) throw new Error("Ambiguous return path");
          for (const key of Array.from(target.searchParams.keys())) {
            if (target.pathname !== "/connect" || !allowed.includes(key)) target.searchParams.delete(key);
          }
          config.returnTo = target.pathname + target.search;
        }
      } catch {}
    }
  }
  function bounded(promise, message) {
    return new Promise(function(resolve, reject) {
      const timeout = setTimeout(function() { reject(new Error(message)); }, 20000);
      Promise.resolve(promise).then(function(value) { clearTimeout(timeout); resolve(value); }, function(error) { clearTimeout(timeout); reject(error); });
    });
  }
  function script(path, key) {
    return new Promise(function(resolve, reject) {
      const node = document.createElement("script");
      node.src = config.origin + path; node.async = true; node.crossOrigin = "anonymous"; if (config.nonce) node.nonce = config.nonce;
      if (key) node.setAttribute("data-clerk-publishable-key", config.publishableKey);
      node.onload = resolve; node.onerror = function() { reject(new Error("Sign-in could not load. Check your connection, then reload this page.")); };
      document.head.appendChild(node);
    });
  }
  const ready = bounded((async function() {
    ${withUi ? 'await Promise.all([script("/npm/@clerk/ui@1/dist/ui.browser.js", false), script("/npm/@clerk/clerk-js@6/dist/clerk.browser.js", true)]);' : 'await script("/npm/@clerk/clerk-js@6/dist/clerk.browser.js", true);'}
    if (!window.Clerk) throw new Error("Sign-in could not load. Reload this page to try again.");
    const options = { telemetry: { disabled: true }, signInUrl: config.signInPath + "?return_to=" + encodeURIComponent(config.returnTo), signInForceRedirectUrl: config.returnTo, signUpForceRedirectUrl: config.returnTo, allowedRedirectOrigins: [location.origin] };
    ${withUi ? 'if (!window.__internal_ClerkUICtor) throw new Error("The sign-in form could not load. Reload this page to try again."); options.ui = { ClerkUI: window.__internal_ClerkUICtor };' : ""}
    await window.Clerk.load(options);
    return window.Clerk;
  })(), "Sign-in is taking too long to load. Check your connection, then reload this page.");
  // Callers render errors; suppress an unhandled rejection before their script runs.
  ready.catch(function() {});
  window.AgentConnectAuth = {
    ready: ready,
    returnTo: config.returnTo,
    apiUrl: config.apiUrl,
    signInPath: config.signInPath,
    getToken: async function(force) {
      const clerk = await ready;
      if (!clerk.session) return null;
      return bounded(clerk.session.getToken(force ? { skipCache: true } : {}), "Your session could not refresh. Check your connection and try again.");
    }
  };
})();</script>`;
}

export function clerkSignInPage(input: ClerkUiConfig): string {
  const config = publicConfig(input);
  const logo = input.assets?.["assets/hitchhike-bus-logo.png"];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="theme-color" content="#ffffff"><meta name="robots" content="noindex"><title>Sign in · Hitchhike</title>
  <link rel="preconnect" href="${esc(config.origin)}" crossorigin>
  <link rel="preload" href="${esc(config.origin)}/npm/@clerk/ui@1/dist/ui.browser.js" as="script" crossorigin="anonymous">
  <link rel="preload" href="${esc(config.origin)}/npm/@clerk/clerk-js@6/dist/clerk.browser.js" as="script" crossorigin="anonymous">
  <style>
  :root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#17191b;background:#fff}*{box-sizing:border-box}body{margin:0;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}main{width:min(100% - 40px,420px);margin:clamp(36px,7vh,72px) auto 32px}.brand{display:flex;width:fit-content;margin:0 auto 32px;text-decoration:none;font-size:28px;font-weight:750;letter-spacing:-.04em}.brand-crop{position:relative;display:block;width:166px;aspect-ratio:1888 / 411;overflow:hidden}.brand-crop img{position:absolute;width:115.042%;max-width:none;height:auto;left:-7.309%;top:-37.713%}a{color:inherit;text-underline-offset:3px}button,a{touch-action:manipulation}a:focus-visible,button:focus-visible{outline:2px solid #b94316;outline-offset:4px}
  .auth-panel{display:grid;position:relative;min-height:556px;border:1px solid #e4e7eb;border-radius:12px;background:#fff;overflow:hidden}#sign-in,#auth-placeholder{grid-area:1/1;min-width:0}#sign-in{width:100%;max-width:100%;align-self:start;opacity:0;transition:opacity .12s ease-out}.auth-panel[data-ready=true] #sign-in{opacity:1}.auth-panel[data-failed=true]{min-height:0;padding:28px}.auth-panel[data-failed=true] #sign-in{display:none}#auth-placeholder{padding:30px 28px;align-self:start;pointer-events:none}.skeleton-title{height:22px;width:70%;margin:3px auto 10px;border-radius:4px;background:#edf0f2}.skeleton-subtitle{height:12px;width:82%;margin:0 auto 30px;border-radius:3px;background:#f2f4f5}.skeleton-button{height:44px;margin-top:10px;border:1px solid #edf0f2;border-radius:6px;background:#fafbfc}.skeleton-divider{height:1px;background:#edf0f2;margin:26px 0}.skeleton-label{height:12px;width:90px;margin:0 0 9px;background:#f0f2f4;border-radius:3px}.skeleton-field{height:44px;border:1px solid #edf0f2;border-radius:6px}.skeleton-action{height:44px;margin-top:24px;background:#f0f2f4;border-radius:6px}.skeleton-note{font-size:12px;text-align:center;color:#737b85;margin:24px 0 0}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.error{color:#a3241c;margin:0 0 18px;font-size:14px}#auth-retry{margin:0;font-size:14px}#auth-retry a{color:#a63813}#auth-reset{padding:10px 14px;border:1px solid #d6dbe0;border-radius:6px;background:#fff;font:inherit;cursor:pointer;margin-bottom:16px}.auth-footer{margin-top:24px;display:flex;justify-content:center;gap:22px;font-size:12px;color:#626872}.auth-footer a{text-decoration:none}.auth-footer a:hover{text-decoration:underline}
  #sign-in .cl-rootBox,#sign-in .cl-cardBox{width:100%;max-width:100%}#sign-in .cl-cardBox{box-shadow:none;border:0;border-radius:0}#sign-in .cl-card{width:100%;box-shadow:none;border:0;border-radius:0;padding:28px;background:#fff}#sign-in .cl-headerTitle{font-size:23px;line-height:1.25;letter-spacing:-.025em;font-weight:650;color:#17191b}#sign-in .cl-headerSubtitle{color:#626872;font-size:14px}#sign-in .cl-main,#sign-in .cl-form{width:100%;min-width:0}#sign-in .cl-header{text-align:center}#sign-in .cl-socialButtons{width:100%;display:grid;grid-template-columns:minmax(0,1fr);gap:10px}#sign-in .cl-socialButtonsBlockButton{min-height:44px;border:1px solid #dfe3e8;border-radius:6px;box-shadow:none;background:#fff}#sign-in .cl-socialButtonsBlockButton:hover{background:#f6f7f8}#sign-in .cl-socialButtonsBlockButtonText{font-size:14px;font-weight:500}#sign-in .cl-formFieldInput{min-height:44px;border:1px solid #d6dbe0;box-shadow:none;border-radius:6px;font-size:15px}#sign-in .cl-formButtonPrimary{min-height:44px;background:#b94316;background-image:none;box-shadow:none;border-radius:6px;text-transform:none;font-size:14px;font-weight:600;color:#fff}#sign-in .cl-formButtonPrimary:hover{background:#9d3510}#sign-in .cl-footer{background:#fff;background-image:none;border-top:1px solid #f0f2f4;padding:16px 28px}#sign-in .cl-footerActionLink{color:#a63813}
  [hidden]{display:none!important}@media(max-width:480px){.auth-panel{min-height:552px}main{width:calc(100% - 32px);margin-top:32px}.brand{margin-bottom:26px}.brand-crop{width:150px}#sign-in .cl-card,#auth-placeholder{padding:26px 22px}.auth-footer{gap:18px}}@media(prefers-reduced-motion:reduce){#sign-in{transition:none}}
  </style></head><body><main><a class="brand" href="/" aria-label="Hitchhike home">${logo ? `<span class="brand-crop"><img src="${esc(logo)}" alt="hitchhike" width="2172" height="724"></span>` : "hitchhike"}</a>
  <section id="auth-panel" class="auth-panel" aria-label="Sign in to Hitchhike" aria-busy="true"><p id="auth-status" class="sr-only" role="status">Loading sign-in…</p><div id="auth-placeholder" aria-hidden="true"><div class="skeleton-title"></div><div class="skeleton-subtitle"></div><div class="skeleton-button"></div><div class="skeleton-button"></div><div class="skeleton-button"></div><div class="skeleton-divider"></div><div class="skeleton-label"></div><div class="skeleton-field"></div><div class="skeleton-action"></div><p class="skeleton-note">Getting sign-in ready</p></div><div id="sign-in"></div><div id="auth-problem" hidden><button id="auth-reset" type="button" hidden>Sign out and try again</button><p id="auth-error" class="error" role="alert" hidden></p><p id="auth-retry" hidden><a href="${esc(config.signInPath)}?return_to=${esc(encodeURIComponent(config.returnTo))}">Try loading sign-in again</a></p></div></section><noscript><style>#auth-panel{display:none}</style><p>Enable JavaScript to sign in securely.</p></noscript><footer class="auth-footer"><a href="/">Back to Hitchhike</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer></main>
  ${clerkBootstrap(input, true)}
  <script${nonceAttr(input)}>(async function() {
    const status = document.getElementById("auth-status"), error = document.getElementById("auth-error"), reset = document.getElementById("auth-reset");
    const panel = document.getElementById("auth-panel"), placeholder = document.getElementById("auth-placeholder"), target = document.getElementById("sign-in");
    const retryLink = document.getElementById("auth-retry").querySelector?.("a");
    if (retryLink) retryLink.href = window.AgentConnectAuth.signInPath + "?return_to=" + encodeURIComponent(window.AgentConnectAuth.returnTo);
    reset.addEventListener("click", async function() {
      reset.disabled = true;
      try { const clerk = await window.AgentConnectAuth.ready; await clerk.signOut(function() {}); location.reload(); }
      catch { error.hidden = false; error.textContent = "Your sign-in provider could not finish signing out. Check your connection and try again."; reset.disabled = false; }
    });
    try {
      const clerk = await window.AgentConnectAuth.ready;
      if (clerk.session) {
        status.textContent = "Opening your workspace…";
        const token = await window.AgentConnectAuth.getToken(true);
        if (!token) throw new Error("Your session expired. Reload sign-in to continue.");
        const response = await fetch((window.AgentConnectAuth.apiUrl || "") + "/auth/clerk/session", { method: "POST", credentials: window.AgentConnectAuth.apiUrl ? "omit" : "same-origin", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}" });
        let body = {}; try { body = await response.json(); } catch {}
        if (!response.ok || !body.authenticated) throw new Error((body.error && body.error.message) || "Your session could not be verified. Reload sign-in to try again.");
        location.replace(window.AgentConnectAuth.returnTo);
        return;
      }
      // Clerk mounts asynchronously; keep the initial frame until its controls exist.
      let observer, timeout;
      const rendered = new Promise(function(resolve, reject) {
        function check() { if (target.querySelector("input, button, [role=alert]")) resolve(); }
        observer = new MutationObserver(check);
        observer.observe(target, { childList: true, subtree: true });
        timeout = setTimeout(function() { reject(new Error("The sign-in form could not load. Please try again.")); }, 20000);
      });
      try {
        clerk.mountSignIn(target, { routing: "hash", withSignUp: true, oauthFlow: "redirect", forceRedirectUrl: window.AgentConnectAuth.returnTo, signUpForceRedirectUrl: window.AgentConnectAuth.returnTo, appearance: { variables: { colorPrimary: "#b94316", colorText: "#17191b", colorTextSecondary: "#626872", colorBackground: "#ffffff", borderRadius: "6px", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }, options: { socialButtonsVariant: "blockButton", socialButtonsPlacement: "top" } } });
        await rendered;
        placeholder.hidden = true; status.hidden = true;
        panel.setAttribute("data-ready", "true"); panel.setAttribute("aria-busy", "false");
      } finally { observer.disconnect(); clearTimeout(timeout); }
    } catch (problem) {
      placeholder.hidden = true; panel.setAttribute("data-failed", "true"); panel.setAttribute("aria-busy", "false"); document.getElementById("auth-problem").hidden = false;
      status.hidden = true; error.hidden = false; error.textContent = problem.message || "Sign-in is unavailable. Reload this page to try again.";
      document.getElementById("auth-retry").hidden = false;
      reset.hidden = !(window.Clerk && window.Clerk.session);
    }
  })();</script></body></html>`;
}

/** Refresh before native submission; strict CSRF and the original consent request remain intact. */
export function clerkConsentScript(input: ClerkUiConfig): string {
  return `${clerkBootstrap(input)}<script${nonceAttr(input)}>(function() {
  const form = document.getElementById("oauth-consent");
  const error = document.getElementById("auth-error");
  const status = document.getElementById("auth-status");
  const buttons = Array.from(form.querySelectorAll("button"));
  let busy = false, readyToSubmit = false;
  function failure(problem) { status.hidden = true; error.hidden = false; error.textContent = problem.message || "Your session could not refresh. Reload this page to try again."; }
  window.AgentConnectAuth.ready.then(function(clerk) {
    if (!clerk.session) throw new Error("Your session expired. Sign in again to continue.");
    status.hidden = true; buttons.forEach(function(button) { button.disabled = false; });
  }).catch(failure);
  form.addEventListener("submit", async function(event) {
    if (readyToSubmit) return;
    event.preventDefault();
    if (busy) return;
    busy = true; error.hidden = true;
    const submitter = event.submitter;
    buttons.forEach(function(button) { button.disabled = true; });
    status.hidden = false; status.textContent = "Checking your session…";
    try {
      const token = await window.AgentConnectAuth.getToken(true);
      if (!token) throw new Error("Your session expired. Sign in again to continue.");
      form.elements.namedItem("clerk_session_token").value = token;
      buttons.forEach(function(button) { button.disabled = false; });
      readyToSubmit = true;
      form.requestSubmit(submitter || undefined);
    } catch (problem) {
      busy = false; buttons.forEach(function(button) { button.disabled = false; }); failure(problem);
    }
  });
})();</script>`;
}
