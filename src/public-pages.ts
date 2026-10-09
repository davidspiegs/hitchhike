/** Public marketing metadata is separate from authenticated workspace responses. */
export const PUBLIC_SITE_ORIGIN = "https://hitchhike.dev";
export const PUBLIC_HOME_TITLE = "Hitchhike — hand work between your AI agents";

export function isPublicDocument(request: Request, env: {HOSTED?: string; PUBLIC_URL?: string}): boolean {
  const url = new URL(request.url);
  // Any cookie is conservatively private, including an expired session or an
  // unfamiliar future provider cookie. Query strings can carry auth transport.
  return env.HOSTED === "true" && env.PUBLIC_URL === PUBLIC_SITE_ORIGIN &&
    url.origin === PUBLIC_SITE_ORIGIN && ["/", "/privacy"].includes(url.pathname) &&
    ["GET", "HEAD"].includes(request.method) && !url.search &&
    !request.headers.has("Cookie") && !request.headers.has("Authorization");
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);

export function publicPageMetadata(path: "/" | "/privacy", indexable = false): string {
  if (!indexable) return '<meta name="robots" content="noindex">';
  const title = path === "/" ? PUBLIC_HOME_TITLE : "Privacy and data · Hitchhike";
  const description = path === "/"
    ? "Connect the AI apps and agents you already use. Hand off tasks with context, bring results back, and keep work moving across devices. Hosted or self-hosted."
    : "How Hitchhike handles account information, tasks, context, results, retention, exports, and deletion.";
  const url = PUBLIC_SITE_ORIGIN + path;
  return `<meta name="robots" content="index, follow">
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Hitchhike">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}">`;
}
