import { dashboardHtml } from "../src/dashboard";
import { workspaceHtml } from "../src/workspace-ui";
import { clerkBootstrap, clerkSignInPage, type ClerkUiConfig } from "../src/clerk-ui";
import { privacyHtml } from "../src/privacy";
import { termsHtml } from "../src/terms";
import { CONSENT_CSS, consentBrand } from "../src/consent-ui";
import { publicDocsPages } from "./public-docs";
export { publicDocsText } from "./public-docs";

export type FrontendConfig = { apiUrl: string; frontendApi: string; publishableKey: string; siteUrl: string; assets?: Record<string, string> };

export function frontendPages(config: FrontendConfig): Record<string, string> {
  const clerk: ClerkUiConfig = { ...config, returnTo: "/app", signInPath: "/sign-in" };
  return {
    ...publicDocsPages(config),
    "/app": dashboardHtml("Hitchhike", {
      hosted: true, authConfigured: true, authProvider: "clerk", clerk,
      apiUrl: config.apiUrl, signInPath: "/sign-in", assets: config.assets,
    }),
    "/app-next": workspaceHtml("Hitchhike", {
      hosted: true, authConfigured: true, authProvider: "clerk", clerk: {...clerk,returnTo:"/app-next"},
      apiUrl: config.apiUrl, signInPath: "/sign-in", assets: config.assets,
    }),
    "/sign-in": clerkSignInPage({ ...clerk, returnFromQuery: true, assets: config.assets }),
    "/connect": connectPage(clerk, config.assets),
    "/privacy": privacyHtml({ indexable: true }),
    "/terms": termsHtml(),
  };
}

function connectPage(clerk: ClerkUiConfig, assets?: Record<string, string>): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>Connect your assistant · Hitchhike</title><style>${CONSENT_CSS}</style></head><body><main>
${consentBrand(assets?.["assets/hitchhike-bus-logo.png"])}<h1 id="connect-title">Connect your assistant</h1>
<p id="auth-status" role="status">Loading connection request…</p><p id="auth-error" class="error" role="alert" hidden></p>
<div id="consent-details" hidden><p id="signed-in" class="hint signed-in"></p>
<div id="fixed-connection" class="connection-summary" hidden><p id="connection-purpose"></p></div>
<form id="oauth-consent"><div id="agent-picker"><label for="agent-id">Which connection should this app use?</label><select id="agent-id" name="agent_id" required aria-describedby="connection-selection"></select><p id="connection-selection" class="hint" role="status"></p></div>
<fieldset id="new-connection" class="new-connection" hidden><legend>Set up its connection</legend><p id="new-connection-intro" class="hint"></p>
<label for="new-platform">Assistant</label><select id="new-platform"></select>
<label for="new-name">Name in your workspace</label><input id="new-name" type="text" maxlength="60" autocomplete="off" spellcheck="false">
<p id="new-roles-label" class="field-label">What can it do?</p><div class="checks" role="group" aria-labelledby="new-roles-label">
<label class="check"><input id="new-can-request" type="checkbox"><span><strong>Send tasks</strong><small>Ask your other assistants for help and get their results.</small></span></label>
<label class="check"><input id="new-can-work" type="checkbox"><span><strong>Receive tasks</strong><small>Take on work your other assistants send it.</small></span></label></div></fieldset>
<p id="no-agents" hidden>Create a connection in <a href="/app">your workspace</a>, then restart this connection flow.</p>
<p id="scope-heading" class="field-label">This app will be able to</p><ul id="scope-list" class="permissions" aria-labelledby="scope-heading"></ul><p class="hint">Your Hitchhike permissions still apply. You can disconnect this app at any time.</p>
<div class="actions"><button id="consent-allow" name="decision" value="allow" type="submit" disabled>Connect</button><button name="decision" value="deny" class="secondary" type="submit" formnovalidate>Cancel</button></div></form>
<details class="connection-details"><summary>Connection details</summary><dl><dt>App requesting access</dt><dd id="client-name"></dd><div id="client-host-row" hidden><dt>Published by</dt><dd id="client-host"></dd></div><dt>Return address</dt><dd><code id="redirect-origin"></code></dd><dt>Hitchhike connection</dt><dd id="connection-id">Choose a connection to see its ID</dd></dl></details></div>
<p id="auth-retry" hidden><a href="/connect">Try this connection again</a></p><noscript><p>Enable JavaScript to connect your assistant.</p></noscript><footer><a href="/app">Your agents</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer></main>
${clerkBootstrap(clerk)}
<script src="/web/connect.js" defer></script></body></html>`;
}
