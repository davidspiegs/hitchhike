const authorizationParameters = new Set([
  "response_type", "client_id", "redirect_uri", "state", "scope",
  "code_challenge", "code_challenge_method", "resource",
]);

/** Only application return state may be saved or rendered. Clerk transport
 * parameters can carry credentials and must never become a return link. */
export function safeAuthReturn(value: string | null, base: string): string {
  if (!value) return "/";
  let target: URL;
  try { target=new URL(value,base); } catch { return "/"; }
  if (target.origin!==base || target.username || target.password || !["/","/beta","/oauth/authorize"].includes(target.pathname)) return "/";
  if (target.pathname==="/" || target.pathname==="/beta") return target.pathname;
  for (const key of [...target.searchParams.keys()]) {
    if (!authorizationParameters.has(key)) target.searchParams.delete(key);
  }
  return target.pathname+target.search;
}

/** Browser UI routes are deliberately separate from backend OAuth endpoints. */
export function safeFrontendReturn(value: string | null, base: string): string {
  if (!value) return "/app";
  let target: URL;
  try { target = new URL(value, base); } catch { return "/app"; }
  if (target.origin !== base || target.username || target.password ||
      !["/app","/app-next","/connect"].includes(target.pathname)) return "/app";
  if (target.pathname === "/app" || target.pathname === "/app-next") return target.pathname;
  const params = new URLSearchParams();
  for (const key of authorizationParameters) {
    // Do not turn an ambiguous authorization request into a different request.
    if (target.searchParams.getAll(key).length > 1) return "/app";
    const value = target.searchParams.get(key);
    if (value !== null) params.set(key, value);
  }
  return "/connect" + (params.size ? "?" + params.toString() : "");
}
