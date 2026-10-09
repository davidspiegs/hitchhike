/** Approved terms for the hosted Hitchhike service. */
export function termsHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Service terms · Hitchhike</title>
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
<h1>Service terms</h1>
<p class="muted">Effective September 26, 2026</p>
<p>These terms cover the hosted Hitchhike service at hitchhike.dev, operated by David Spiegel. By using the hosted service, you agree to these terms.</p>

<h2>The service</h2>
<p>Hitchhike routes tasks, supplied context, and results between the AI apps and agents you connect. Those agents use their own providers, accounts, and tools. Hitchhike does not provide model subscriptions or combine their usage limits.</p>
<p>The hosted service is currently free, subject to usage and retention limits. Your workspace shows your handoff allowances and history settings. Features, limits, and availability may change. Handoffs can fail, be delayed, or require retries; uptime and task completion times are not guaranteed. Keep copies of work you need.</p>

<h2>Your content</h2>
<p>You keep your ownership of the content you submit. These terms do not give Hitchhike ownership of your content or results. You authorize Hitchhike to store, process, display, and transmit your content only as needed to route your tasks, return results, and operate your workspace, including through its hosting providers and the agents you connect.</p>

<h2>Your connections and instructions</h2>
<p>Connect only accounts and tools you are allowed to use, and share only content you are authorized to provide. You are responsible for the tasks and permissions you authorize, including actions those permissions allow your agents to take. Review agent output before relying on it or letting it trigger important actions.</p>
<p>Connected providers have their own terms, permissions, and usage limits, which you must follow. Do not use Hitchhike to bypass those restrictions, access someone else's workspace, or disrupt the service.</p>

<h2>Privacy and leaving</h2>
<p>The <a href="/privacy">Privacy and data page</a> explains access to stored content, retention, exports, and deletion. You can stop using Hitchhike at any time. Disconnect agents from their connection settings, and use Workspace settings to export data or delete your hosted workspace. Copies already held by connected providers follow those providers' policies.</p>

<h2>Open-source and self-hosted use</h2>
<p>The MIT License included with the source governs using, copying, modifying, and distributing that source. These hosted-service terms do not replace that license. Each self-hosted instance is controlled by its own operator.</p>

<footer>
<p>For questions, open an issue in the <a href="https://github.com/davidspiegs/hitchhike/issues" rel="noopener noreferrer">Hitchhike project on GitHub</a>. Issues are public: do not include passwords, tokens, private task content, or other secrets.</p>
<p class="muted"><a href="/">Return to your workspace</a> · <a href="/privacy">Privacy and data</a></p>
</footer>
</main></body></html>`;
}
