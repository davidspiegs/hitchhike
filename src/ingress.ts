/** Cheap, provider-enforced admission before any database-backed authentication.
 * Cloudflare RateLimit counters are per location, not a global billing cap.
 * Stable keys avoid an attacker allocating a fresh bucket with each credential.
 */
export interface IngressEnvironment {
  HOSTED?: string;
  RESOURCE_BUDGETS_ENABLED?: string;
  PUBLIC_URL?: string;
  AUTH_RATE_LIMITER?: RateLimit;
  GLOBAL_RATE_LIMITER?: RateLimit;
  RATE_LIMITER?: RateLimit;
}
const local = (value: string) => { try { return ['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname); } catch { return false; } };
export const localDevelopment = (env: IngressEnvironment, request: Request) => local(env.PUBLIC_URL ?? '') && local(request.url);
export const protectedRoute = (path: string) => /^(?:\/auth\/|\/oauth\/|\/v1\/|\/mcp(?:\/|$)|\/w\/)/.test(path);
export function ingressConfigurationIssue(env: IngressEnvironment): string | null {
  if (env.HOSTED !== 'true' && env.RESOURCE_BUDGETS_ENABLED !== 'true') return null;
  return env.AUTH_RATE_LIMITER && env.GLOBAL_RATE_LIMITER && env.RATE_LIMITER ? null
    : 'Configure AUTH_RATE_LIMITER, GLOBAL_RATE_LIMITER and RATE_LIMITER before enabling hosted access.';
}
function networkKey(ip: string): string {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return ip;
  if (!/^[\da-f:]{2,45}$/i.test(ip)) return 'unknown';
  const halves = ip.toLowerCase().split('::');
  if (halves.length > 2) return 'unknown';
  const left = halves[0].split(':').filter(Boolean), right = (halves[1] ?? '').split(':').filter(Boolean);
  const groups = halves.length === 2 ? [...left, ...Array(Math.max(0,8-left.length-right.length)).fill('0'), ...right] : left;
  return groups.length === 8 ? groups.slice(0,4).map(x=>x.padStart(4,'0')).join(':') : 'unknown';
}
export async function ingressAdmission(request: Request, env: IngressEnvironment): Promise<Response|null> {
  if ((env.HOSTED !== 'true' && env.RESOURCE_BUDGETS_ENABLED !== 'true') || !protectedRoute(new URL(request.url).pathname) || localDevelopment(env,request)) return null;
  const issue=ingressConfigurationIssue(env);
  const response=(code:string,message:string,status:number)=>new Response(JSON.stringify({error:{code,message}}),{status,headers:{'Content-Type':'application/json','Retry-After':'60','Cache-Control':'no-store'}});
  if (issue) return response('setup_required',issue,503);
  const path=new URL(request.url).pathname;
  // Security webhooks have independent ingress capacity; their signatures are
  // verified before database work in the auth handler.
  const category=path==='/auth/clerk/webhook' ? 'security-webhook' : path.startsWith('/oauth/') || path.startsWith('/auth/') || path==='/v1/pair' ? 'auth' : 'api';
  try {
    // A caller already rejected by its address bucket must not spend shared
    // capacity and lock out everyone else at the same Cloudflare location.
    if (!(await env.AUTH_RATE_LIMITER!.limit({key:category+':'+networkKey(request.headers.get('CF-Connecting-IP') ?? '')})).success ||
        !(await env.GLOBAL_RATE_LIMITER!.limit({key:'ingress:'+category})).success)
      return response('rate_limited','Too many requests. Wait a minute before checking again.',429);
  } catch { return response('ingress_unavailable','Request protection is temporarily unavailable. Please retry later.',503); }
  return null;
}
