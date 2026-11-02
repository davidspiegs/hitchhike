
import { clerkBootstrap, type ClerkUiConfig } from "./clerk-ui";
import { WORKSPACE_CSS } from "./workspace-theme";
import { WORKSPACE_JS } from "./workspace-client";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
export interface WorkspaceOptions { hosted?: boolean; authConfigured?: boolean; authProvider?: "google" | "clerk"; clerk?: ClerkUiConfig; nonce?: string; publicLanding?: boolean; apiUrl?: string; signInPath?: string; assets?: Record<string, string> }
const FONTS: [family: string, file: string, weight: number, preload: boolean][] = [
  ["Inter", "Inter-Regular", 400, true], ["Inter", "Inter-Medium", 500, false], ["Inter", "Inter-SemiBold", 600, true],
  ["Inter Display", "InterDisplay-SemiBold", 600, true], ["JetBrains Mono", "JetBrainsMono-Medium", 500, false], ["JetBrains Mono", "JetBrainsMono-SemiBold", 600, false],
];
// Hashed same-origin asset paths only; anything else is left to the system font stack.
const fontUrl = (assets: Record<string, string>, file: string) => {
  const url = assets[`assets/fonts/${file}.woff2`];
  return url && /^\/[A-Za-z0-9._/-]+\.woff2$/.test(url) ? url : null;
};
const ICONS = {
  assistants: '<rect x="3.5" y="3.5" width="5.6" height="5.6" rx="1.7"/><rect x="10.9" y="3.5" width="5.6" height="5.6" rx="1.7"/><rect x="3.5" y="10.9" width="5.6" height="5.6" rx="1.7"/><rect x="10.9" y="10.9" width="5.6" height="5.6" rx="1.7"/>',
  activity: '<path d="M2.8 10h3.1l2.2-5.2 3.8 10.4 2.2-5.2h3.1"/>',
  settings: '<path d="M3.5 6.5h7.5M15 6.5h1.5M3.5 13.5h1.5M9 13.5h7.5"/><circle cx="13" cy="6.5" r="2"/><circle cx="7" cy="13.5" r="2"/>',
  person: '<circle cx="10" cy="7" r="3.2"/><path d="M3.8 16.5a6.2 6.2 0 0 1 12.4 0"/>',
};
const svg = (paths: string) => `<svg class="i" viewBox="0 0 20 20" aria-hidden="true">${paths}</svg>`;
/** Opt-in next-release interface. Authentication is identical to the legacy dashboard. */
export function workspaceHtml(name: string, options: WorkspaceOptions = {}): string {
  const assets = options.assets || {};
  const logo = assets["assets/hitchhike-bus-logo.png"];
  const returnTo = options.clerk?.returnTo === "/app-next" ? "/app-next" : "/app";
  const fonts = FONTS.map(([family, file, weight]) => {
    const url = fontUrl(assets, file);
    return url ? `@font-face{font-family:"${family}";src:url("${url}") format("woff2");font-weight:${weight};font-style:normal;font-display:swap}` : "";
  }).join("");
  const preload = FONTS.filter(([, file, , wanted]) => wanted && fontUrl(assets, file)).map(([, file]) => `<link rel="preload" href="${esc(fontUrl(assets, file)!)}" as="font" type="font/woff2" crossorigin>`).join("");
  const brand = (cls: string, width: number, height: number) => logo
    ? `<a class="${cls}" href="#/agents" aria-label="${esc(name)} home"><img src="${esc(logo)}" alt="${esc(name)}" width="${width}" height="${height}"></a>`
    : `<a class="brand-text" href="#/agents">${esc(name)}</a>`;
  const nav = (id: string, page: string, label: string, icon: string, extra = "") => `<a href="#/${page}" id="${id}" data-nav="${page}"${extra}>${svg(icon)}${label}</a>`;
  const tab = (page: string, label: string, icon: string) => `<a href="#/${page}" data-nav="${page}">${svg(icon)}${label}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light"><meta name="theme-color" content="#ffffff"><meta name="robots" content="noindex"><title>Your assistants · ${esc(name)}</title>${preload}<style>${fonts}${WORKSPACE_CSS}</style></head><body data-hosted="${options.hosted ? "true" : "false"}" data-auth-provider="${options.authProvider === "clerk" ? "clerk" : "google"}" data-api-url="${esc(options.apiUrl || "")}" data-assets="${esc(JSON.stringify(assets))}"><a class="hidden-link" href="#main">Skip to content</a>
<div id="boot" class="gate" role="status"><div class="skeleton"></div><div class="skeleton short"></div><p class="muted">Opening your workspace…</p></div>
<section id="gate" class="gate" hidden>${logo ? `<a class="brand" href="/" aria-label="${esc(name)} home"><img src="${esc(logo)}" alt="${esc(name)}" width="105" height="35"></a>` : `<a class="brand-text" href="/">${esc(name)}</a>`}<h1>Your assistants, working together.</h1><p class="muted">Sign in to connect your assistants and keep their handoffs together.</p><p id="session-error" class="error-text" role="alert" hidden></p>${options.hosted ? `${options.authConfigured ? `<a class="btn lg" id="gate-sign-in" href="${options.signInPath === "/sign-in" ? "/sign-in?return_to=" + encodeURIComponent(returnTo) : "/auth/start"}">Sign in or create an account</a>` : `<p class="error-text">Sign-in is not configured for this deployment.</p>`}` : `<form id="gate-form"><div class="form-group"><label for="owner-key">Owner key</label><input id="owner-key" type="password" required autocomplete="current-password"></div><button class="btn lg" type="submit">Open workspace</button></form>`}</section>
<div id="workspace" class="shell" hidden><aside class="sidebar">${brand("brand", 105, 35)}<nav class="snav" aria-label="Main navigation">${nav("agents-nav", "agents", "Your assistants", ICONS.assistants)}${nav("activity-nav", "activity", "Activity", ICONS.activity)}${nav("settings-nav", "settings", "Settings", ICONS.settings, ' aria-label="Workspace settings"')}</nav><div id="side-agents"></div><a class="acct" id="account-chip" href="#/settings"><span class="av" id="account-avatar">${svg(ICONS.person)}</span><span id="account-label">Your workspace</span></a></aside>
<header class="mtop">${brand("mbrand", 96, 32)}<a class="av" id="account-button" href="#/settings" aria-label="Account and settings">${svg(ICONS.person)}</a></header>
<div class="pane"><div id="network-error" class="navigation-error" role="status" hidden></div><main class="main" id="main" tabindex="-1"></main></div>
<nav class="tabs" aria-label="Main">${tab("agents", "Assistants", ICONS.assistants)}${tab("activity", "Activity", ICONS.activity)}${tab("settings", "Settings", ICONS.settings)}</nav></div><div id="toast" class="toast" role="status" aria-live="polite" hidden></div><noscript><p class="gate">Enable JavaScript to use Hitchhike.</p></noscript>
${options.hosted && options.authProvider === "clerk" && options.clerk ? clerkBootstrap(options.clerk) : ""}<script${options.nonce ? ` nonce="${esc(options.nonce)}"` : ""}>${WORKSPACE_JS}</script></body></html>`;
}
