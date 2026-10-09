import { publicPageMetadata } from "./public-pages";

/** Factual description of the current hosted implementation; no third-party assets or scripts. */
export function privacyHtml(options: {indexable?: boolean} = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy and data · Hitchhike</title>
${publicPageMetadata("/privacy", options.indexable)}
<style>
:root{color-scheme:light dark;--paper:#F4F6F8;--ink:#16202A;--muted:#5B6878;--rule:#E0E5EA}
@media(prefers-color-scheme:dark){:root{--paper:#10161D;--ink:#E4EAF0;--muted:#9AA8B6;--rule:#24303B}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:740px;margin:auto;padding:36px 24px 64px}a{color:inherit;text-underline-offset:3px}a:focus-visible{outline:2px solid currentColor;outline-offset:4px}
.brand{font-weight:600;letter-spacing:-.03em;text-decoration:none}h1{font-size:32px;line-height:1.2;letter-spacing:-.035em;margin:36px 0 8px}h2{font-size:19px;line-height:1.35;margin:28px 0 8px}p{margin:0 0 14px;overflow-wrap:anywhere}.muted{color:var(--muted);font-size:14px}footer{border-top:1px solid var(--rule);margin-top:32px;padding-top:20px}
</style>
</head>
<body><main>
<a class="brand" href="/">Hitchhike</a>
<h1>Privacy and data</h1>
<p class="muted">Updated October 2, 2026</p>
<p>Hitchhike stores the information needed to connect your AI apps, deliver tasks, and return results. This page describes the current hosted service.</p>

<h2>Account and connection information</h2>
<p>The sign-in method configured by the operator provides an account identifier and verified email address. The service stores the identity mapping, a display name, workspace settings, and records needed to authorize access. Direct Google sign-in uses a relay session cookie. When Clerk is configured, Clerk manages the browser session and the relay verifies it to authorize requests.</p>
<p>The service also stores connection names, permissions, authentication records, and credentials needed to connect workers. If you configure a webhook, its destination and authorization settings are stored to request runs. Your AI provider passwords are not requested by this service.</p>

<h2>Tasks and who can access them</h2>
<p>Task titles, instructions, context, links, results, questions, replies, activity history, and usage records are stored to operate your workspace. Connected apps can access tasks and metadata allowed by their connection permissions. Their providers receive the context you hand over through the relay; your complete chat history and local files are not automatically copied.</p>
<p>Recoverable relay connection keys are encrypted by the application. Task content and other service data are readable by the hosted operator. This is not end-to-end encryption. Each connected provider handles the information it receives under its own policies.</p>

<h2>Services used</h2>
<p>The hosted website and dashboard are served by Vercel. The relay API, task storage, and scheduled maintenance run on Cloudflare. Clerk processes account/profile information, verified email addresses, and authentication/session data; the chosen social provider also processes its login. Task briefs, results, and agent credentials are not sent to Clerk as account metadata. The dashboard requests its workspace data directly from the Cloudflare API and its fonts from Google Fonts. The current app includes no advertising or third-party product analytics code.</p>

<h2>Retention, export, and deletion</h2>
<p>Persistent conversations are kept together for 30 days after their last message. A conversation is not removed while any of its requests remains outstanding. Older standalone tasks follow the workspace’s 1–30 day retention setting. Content is removed through scheduled cleanup. Minimal task metadata used to enforce usage limits is retained for at least 35 days before cleanup. Security and usage counters may outlast task content; background launch admission records are retained for up to 90 days before batched cleanup. Cleanup runs in batches, so removal is not instantaneous.</p>
<p>You can export workspace data or delete your hosted workspace from Workspace settings. Exports exclude reusable connection credentials. Workspace deletion removes active workspace and account data and revokes its connections. It does not delete conversations or data held by your connected AI providers.</p>
<p>Deleting relay data does not delete your Google, GitHub, or X account. Where Clerk is configured, deletion also requests removal of your user in this application's Clerk instance. Access is blocked locally immediately; a failed provider cleanup request is stored and retried. Small one-way identity and session hashes remain to prevent deleted credentials recreating accounts. Pending cleanup retains the Clerk instance and opaque account identifier until completed, without storing raw credential tokens for that purpose.</p>
<p>Hosted accounts using the direct Google sign-in flow retain only an identity hash and expiry for a 30-day signup cooldown after deletion. This prevents repeated deletion from resetting free-service allowances; the deleted name, email and task content are not kept in that cooldown record.</p>
<p>Clerk's operational records and retention follow its provider policies. Provider records and backups may remain after relay data is removed.</p>
<p>Cloudflare-managed backups may retain copies after application deletion until the applicable recovery window expires. The workspace history setting does not control those backups.</p>

<h2>Self-hosted instances</h2>
<p>Each self-hosted instance is controlled by its own operator. The single-owner self-hosted mode does not require a Clerk or Google account. That operator controls its deployment, data, credentials, backups, and retention. Contact that operator about information stored in their instance.</p>

<footer>
<p>For questions about this hosted service, contact the project owner through <a href="https://github.com/davidspiegs" rel="noopener noreferrer">David Spiegel’s GitHub profile</a>.</p>
<p class="muted"><a href="/">Return to your workspace</a> · <a href="/terms">Terms</a></p>
</footer>
</main></body></html>`;
}
