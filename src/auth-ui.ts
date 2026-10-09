import { clerkConsentScript, type ClerkUiConfig } from "./clerk-ui";
import { CONSENT_CSS, consentBrand } from "./consent-ui";
import { safeAuthReturn } from "./auth-return";

/** Direct Google and local test pages stay script-free. Clerk consent refreshes its session. */
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);

function page(title: string, body: string, scripts = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1,viewport-fit=cover"><title>${esc(title)} · Hitchhike</title><style>${CONSENT_CSS}</style></head><body><main>${consentBrand()}${body}<footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer></main>${scripts}</body></html>`;
}

export function authMessage(title: string, message: string, link = "/", label = "Return to your workspace"): string {
  return page(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="${esc(link)}">${esc(label)}</a></p>`);
}

export function devLoginPage(): string {
  return page("Local development sign-in", `<h1>Local development sign-in</h1><p>This test form is only available on localhost when development authentication is explicitly enabled. It does not verify email ownership.</p><form action="/auth/dev" method="post"><label>Test account email <input name="email" type="email" autocomplete="username" required></label><button type="submit">Open test workspace</button></form><p><small>Public deployments use the configured sign-in provider.</small></p>`);
}

export function consentPage(input: {
  clerk?: ClerkUiConfig;
  targetAgentId?: string | null;
  clientName: string;
  redirectOrigin: string;
  email: string;
  csrfToken: string;
  requestId: string;
  scopes: readonly string[];
  agents: { id: string; name: string; can_request: number; can_work: number }[];
}): string {
  if (input.clerk) input={...input,clerk:{...input.clerk,returnTo:safeAuthReturn(input.clerk.returnTo,"https://agent-connect.invalid")}};
  const labels: Record<string,string> = {
    "relay:read": "Read shared tasks, replies, and available assistants",
    "relay:send": "Send work to your permitted assistants",
    "relay:work": "Pick up requests and send results back",
    "offline_access": "Stay connected between visits",
  };
  const capabilities = input.scopes.map((s) => `<li>${esc(labels[s] ?? s)}</li>`).join("");
  const disabled = input.clerk ? " disabled" : "";
  const fields = `<input type="hidden" name="request_id" value="${esc(input.requestId)}"><input type="hidden" name="csrf_token" value="${esc(input.csrfToken)}">${input.clerk ? `<input type="hidden" name="clerk_session_token" value="">` : ""}`;
  const target = input.targetAgentId ? input.agents.find(agent => agent.id === input.targetAgentId) : null;
  if (input.targetAgentId && !target) return authMessage("Connection unavailable", "Return to your assistant’s setup page and try connecting again.");
  const picker = target
    ? `<input type="hidden" name="agent_id" value="${esc(target.id)}"><p>Allow this app to use your ${esc(target.name)} connection on Hitchhike.</p>`
    : input.agents.length ? `<label>Which connection should this app use?<select name="agent_id" required aria-describedby="connection-selection"><option value="" disabled selected>Choose a connection…</option>${input.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} — ${a.can_request ? "send" : ""}${a.can_request && a.can_work ? " and " : ""}${a.can_work ? "work" : ""}${!a.can_request && !a.can_work ? "read only" : ""} (${esc(a.id)})</option>`).join("")}</select></label><p id="connection-selection" class="hint">This app used the general Hitchhike address. Choose its connection to continue.</p>` : `<p>Create a connection in <a href="/">your workspace</a>, then restart this connection flow.</p>`;
  return page("Connect your assistant", `<h1>Connect ${esc(target?.name ?? input.clientName)}</h1><p class="hint signed-in">Signed in as ${esc(input.email)}</p><form id="oauth-consent" action="/oauth/authorize" method="post">${fields}${picker}<ul class="permissions" aria-label="Requested permissions">${capabilities}</ul><p class="hint">Your Hitchhike permissions still apply. You can disconnect this app at any time.</p><div class="actions">${input.agents.length ? `<button name="decision" value="allow"${disabled}>Connect${target ? " " + esc(target.name) : ""}</button>` : ""}<button class="secondary" name="decision" value="deny" formnovalidate${disabled}>Cancel</button></div></form><details class="connection-details"><summary>Connection details</summary><dl><dt>App requesting access</dt><dd>${esc(input.clientName)}</dd><dt>Return address</dt><dd><code>${esc(input.redirectOrigin)}</code></dd>${target ? `<dt>Hitchhike connection</dt><dd>${esc(target.name)} · ${esc(target.id)}</dd>` : ""}</dl></details>${input.clerk ? `<p id="auth-status" role="status">Checking your session…</p><p id="auth-error" class="error" role="alert" hidden></p><p class="hint"><a href="/auth/clerk/start?return_to=${esc(encodeURIComponent(input.clerk.returnTo))}">Sign in again</a></p><noscript><p>Enable JavaScript to connect your assistant.</p></noscript>` : ""}`, input.clerk ? clerkConsentScript(input.clerk) : "");
}
