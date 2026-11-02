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

/** The workspace may carry one choice through sign-in: which assistant to add. */
const ASSISTANT_INTENT = /^[a-z][a-z-]{1,23}$/;

/** Browser UI routes are deliberately separate from backend OAuth endpoints. */
export function safeFrontendReturn(value: string | null, base: string): string {
  if (!value) return "/app-next";
  let target: URL;
  try { target = new URL(value, base); } catch { return "/app-next"; }
  if (target.origin !== base || target.username || target.password ||
      !["/app","/app-next","/connect"].includes(target.pathname)) return "/app-next";
  if (target.pathname === "/app") return target.pathname;
  if (target.pathname === "/app-next") {
    const assistant = target.searchParams.getAll("assistant");
    return assistant.length === 1 && ASSISTANT_INTENT.test(assistant[0]) ? "/app-next?assistant=" + assistant[0] : "/app-next";
  }
  const params = new URLSearchParams();
  for (const key of authorizationParameters) {
    // Do not turn an ambiguous authorization request into a different request.
    if (target.searchParams.getAll(key).length > 1) return "/app-next";
    const value = target.searchParams.get(key);
    if (value !== null) params.set(key, value);
  }
  return "/connect" + (params.size ? "?" + params.toString() : "");
}
