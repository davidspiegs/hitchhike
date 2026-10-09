import type { AgentRow, Env } from "./store";
import { authMessage, consentPage, devLoginPage } from "./auth-ui";
import { randomToken, safeEqual, sha256, ulid } from "./util";
import { ClerkAuthError, clerkAction, clerkConfiguration, clerkIdentity, clerkVerifiedEmail, clerkWebhook, type ClerkEnv } from "./clerk-auth";
import { clerkSignInPage, type ClerkUiConfig } from "./clerk-ui";
import { deleteWorkspaceContents } from "./store";
import { safeAuthReturn, safeFrontendReturn } from "./auth-return";
import { deploymentOrigins, OriginConfigurationError } from "./origins";
import { assertAnonymousResourceOperation, assertResourceOperation, ResourceBudgetError } from "./budgets";
import { DEFAULT_HOSTED_STORAGE_LIMIT_BYTES } from "./storage-accounting";

export type AuthEnv = Env & ClerkEnv & {
  AUTH_PROVIDER?: string;
  HOSTED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BETA_EMAILS?: string;
  SIGNUP_MODE?: string;
  ALLOW_DEV_AUTH?: string;
  DEFAULT_DAILY_JOB_LIMIT?: string;
  DEFAULT_MONTHLY_JOB_LIMIT?: string;
  HOSTED_WORKSPACE_LIMIT?: string;
  /** Opt new hosted workspaces into the next release; existing choices are preserved. */
  NEXT_RELEASE_DEFAULT_ENABLED?: string;
  RATE_LIMITER?: { limit(options: {key:string}): Promise<{success:boolean}> };
};
export interface HumanSession {
  userId: string;
  email: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  csrfToken: string;
  sessionHash: string;
  provider?: "google"|"clerk";
  providerSessionId?: string;
}
export interface OAuthIdentity {
  workspaceId: string;
  agent: AgentRow;
  scopes: string[];
}
type User = { id: string; identity_key: string; email: string; name: string; workspace_id: string; identity_checked_at: number };
type Client = { id: string; name: string; redirect_uris: string };
type Grant = { id: string; user_id: string; workspace_id: string; agent_id: string; auth_generation: number; client_id: string; scope: string; resource: string; revoked_at: number | null };
type TenantAgent = AgentRow & { workspace_id: string; auth_generation: number };
type AuthRequest = { clientId: string; redirectUri: string; state: string; challenge: string; scope: string; resource: string };
type IdentitySecurity = { restricted:number; version:number };

const HOUR = 3_600_000;
const DAY = HOUR * 24;
const ACCESS_SECONDS = 900;
const ALL_SCOPES = ["relay:read", "relay:send", "relay:work", "offline_access"];
const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const encoder = new TextEncoder();

/** A public routing identifier, never a credential. Keep one canonical path. */
export function mcpConnectionId(path: string): string | null {
  return /^\/mcp\/connections\/([a-z][a-z0-9_-]{1,31})$/.exec(path)?.[1] ?? null;
}

/** undefined means invalid; null retains the existing unscoped MCP resource. */
function resourceConnectionId(resource: string, base: string): string | null | undefined {
  if (resource === base + "/mcp") return null;
  if (!resource.startsWith(base + "/")) return undefined;
  return mcpConnectionId(resource.slice(base.length)) ?? undefined;
}

export const isHosted = (env: AuthEnv): boolean => env.HOSTED === "true";
export const hasScope = (scopes: readonly string[], required: string): boolean => scopes.includes(required);
export function authProvider(env: AuthEnv): "google"|"clerk" {
  const provider=env.AUTH_PROVIDER ?? "google";
  if (provider!=="google" && provider!=="clerk") fail(503,"setup_required","Configure AUTH_PROVIDER as google or clerk.");
  return provider;
}
const localHost = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
const loopback = (request: Request) => localHost(new URL(request.url).hostname);
function signupMode(env: AuthEnv): "public" | "invite" {
  const mode = env.SIGNUP_MODE ?? "public";
  if (mode !== "public" && mode !== "invite") fail(503,"setup_required","Configure SIGNUP_MODE as public or invite.");
  return mode;
}
const approvedEmail = (env: AuthEnv, email: string) => signupMode(env) === "public" || (env.BETA_EMAILS ?? "").split(/[\s,;]+/).filter(Boolean).map((s) => s.toLowerCase()).includes(email.toLowerCase());

export class AuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new AuthError(status, code, message); }
function origin(request: Request, env: AuthEnv): string {
  const current = new URL(request.url);
  let configured: ReturnType<typeof deploymentOrigins>;
  try { configured = deploymentOrigins(env,current.origin); }
  catch (error) { if (error instanceof OriginConfigurationError) fail(503,"setup_required",error.message); throw error; }
  if (configured.apiOrigin !== current.origin) fail(400, "invalid_host", "Use the configured relay address.");
  if (configured.split && authProvider(env) !== "clerk") fail(503,"setup_required","A separate browser frontend requires Clerk authentication.");
  return configured.apiOrigin;
}
const wantsJson = (request: Request) => (request.headers.get("Accept") ?? "").split(",").some(value => value.split(";",1)[0].trim().toLowerCase() === "application/json");
function headers(extra: HeadersInit = {}): Headers {
  const out = new Headers(extra);
  out.set("Cache-Control", "no-store");
  out.set("Pragma", "no-cache");
  out.set("Referrer-Policy", "no-referrer");
  out.set("X-Content-Type-Options", "nosniff");
  out.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  return out;
}
function json(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  const h = headers(extra); h.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), {status, headers: h});
}
export function authHtml(body: string, status = 200, formRedirectOrigin?: string, clerk?: ClerkUiConfig): Response {
  const h = headers({"Content-Type":"text/html; charset=utf-8"});
  // Browsers send Origin:null for native form POSTs from a no-referrer page.
  // Preserve same-origin form identity for strict CSRF checks while still
  // withholding the referrer when the browser leaves this site.
  h.set("Referrer-Policy","same-origin");
  // Chromium also checks form-action against the response redirect. Consent
  // may return only to this exactly registered, validated callback origin.
  if (formRedirectOrigin) h.set("Content-Security-Policy",`default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${formRedirectOrigin}; base-uri 'none'; frame-ancestors 'none'`);
  if (clerk) h.set("Content-Security-Policy",`default-src 'none'; script-src 'nonce-${clerk.nonce}' ${clerk.frontendApi} https://*.protect.clerk.com https://challenges.cloudflare.com; style-src 'unsafe-inline'; connect-src 'self' ${clerk.frontendApi} https://*.protect.clerk.com:* https://challenges.cloudflare.com; img-src 'self' ${clerk.frontendApi} https://img.clerk.com data:; worker-src 'self' blob:; frame-src ${clerk.frontendApi} https://*.protect.clerk.com https://challenges.cloudflare.com; form-action 'self'${formRedirectOrigin ? " "+formRedirectOrigin : ""}; base-uri 'none'; frame-ancestors 'none'`);
  return new Response(body, {status, headers: h});
}
const html=authHtml;
function redirect(url: string, cookies: string[] = []): Response {
  const h = headers({Location: url});
  for (const value of cookies) h.append("Set-Cookie", value);
  return new Response(null, {status: 303, headers: h});
}
function cookieName(request: Request, purpose = "session"): string {
  return `${new URL(request.url).protocol === "https:" ? "__Host-relay_" : "relay_dev_"}${purpose}`;
}
function cookie(request: Request, purpose: string, value: string, seconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(request, purpose)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`;
}
function readCookie(request: Request, purpose: string): string | null {
  const name = cookieName(request, purpose);
  const parts = (request.headers.get("Cookie") ?? "").split(";").map((s) => s.trim()).filter((s) => s.startsWith(name + "="));
  // Ambiguous cookies never select an attacker-supplied value.
  return parts.length === 1 ? parts[0].slice(name.length + 1) : null;
}
function safeReturn(value: string | null, base: string): string {
  return safeAuthReturn(value,base);
}
async function challenge(verifier: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function limitedBody(request: Request): Promise<string> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 16384) fail(413,"invalid_request","Request is too large.");
  if (!request.body) return "";
  const reader = request.body.getReader();
  let count = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const {done,value} = await reader.read(); if (done) break;
    count += value.byteLength;
    if (count > 16384) { await reader.cancel(); fail(413,"invalid_request","Request is too large."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
async function formBody(request: Request): Promise<URLSearchParams> {
  if (!(request.headers.get("Content-Type") ?? "").startsWith("application/x-www-form-urlencoded")) fail(415,"invalid_request","Use an application/x-www-form-urlencoded request.");
  const params = new URLSearchParams(await limitedBody(request));
  for (const key of params.keys()) if (params.getAll(key).length !== 1) fail(400,"invalid_request","Duplicate parameters are not allowed.");
  return params;
}
async function throttle(request: Request, env: AuthEnv, action: string, limit: number, window = HOUR): Promise<void> {
  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") ?? (loopback(request) ? "local" : "unknown");
  const ipHash=await sha256(ip);
  if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({key:`auth:${action}:${ipHash}`})).success) fail(429,"rate_limited","Too many attempts. Try again later.");
  const bucket = `${action}:${Math.floor(now / window)}:${ipHash}`;
  // Rejected attempts perform no D1 writes and cannot grow either the counter
  // or a distributed collection of anonymous buckets without a hard bound.
  const row = await env.DB.prepare(`INSERT INTO auth_rate_limits(bucket,count,expires_at)
    SELECT ?1,1,?2 WHERE EXISTS(SELECT 1 FROM auth_rate_limits WHERE bucket=?1)
      OR (SELECT COUNT(*) FROM auth_rate_limits)<10000
    ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<?3 RETURNING count`).bind(bucket,now + window * 2,limit).first<{count:number}>();
  if (!row) fail(429,"rate_limited","Too many attempts. Try again later.");
}

/** Shared by browser, OAuth and paired-key authentication. The static key is
 * never sufficient to bypass a hosted owner's current account restrictions. */
export async function workspaceAccountAllowed(env: AuthEnv, workspaceId: string): Promise<boolean> {
  if (!isHosted(env)) return workspaceId==="default";
  const row=await env.DB.prepare(`SELECT u.id,u.email,w.security_suspended,w.identity_restricted,
      EXISTS(SELECT 1 FROM account_deletions d WHERE d.workspace_id=w.id) AS deleting,
      EXISTS(SELECT 1 FROM identity_tombstones t WHERE t.identity_hash=u.identity_hash) AS tombstoned,
      EXISTS(SELECT 1 FROM identity_security s WHERE s.identity_hash=u.identity_hash AND s.restricted=1) AS restricted
    FROM workspaces w JOIN users u ON u.workspace_id=w.id WHERE w.id=?`).bind(workspaceId).first<{id:string;email:string;security_suspended:number;identity_restricted:number;deleting:number;tombstoned:number;restricted:number}>();
  if (!row || row.security_suspended || row.deleting) return false;
  if (row.tombstoned || row.restricted || !approvedEmail(env,row.email)) {
    // Latch invite removal: re-adding an address alone cannot resurrect a
    // stolen key, old OAuth grant or claim. The owner must sign in again.
    if (!row.identity_restricted) await env.DB.prepare(`UPDATE workspaces SET identity_restricted=1 WHERE id=?`).bind(workspaceId).run();
    return false;
  }
  return !row.identity_restricted;
}

const effectiveScopes = (scope: string, agent: AgentRow): string[] => scope.split(" ")
  .filter(s=>ALL_SCOPES.includes(s)).filter(s=>s!=="relay:send" || !!agent.can_request).filter(s=>s!=="relay:work" || !!agent.can_work);

async function restrictIdentityAccess(env: AuthEnv, identityHash: string, reason: string, userId?: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET identity_hash=? WHERE id=?`).bind(identityHash,userId ?? ""),
    env.DB.prepare(`INSERT INTO identity_security(identity_hash,restricted,version,reason,updated_at) VALUES (?,1,1,?,?)
      ON CONFLICT(identity_hash) DO UPDATE SET restricted=1,version=version+1,reason=excluded.reason,updated_at=excluded.updated_at`).bind(identityHash,reason,Date.now()),
    env.DB.prepare(`UPDATE workspaces SET identity_restricted=1 WHERE id IN (SELECT workspace_id FROM users WHERE identity_hash=?)`).bind(identityHash),
    env.DB.prepare(`UPDATE users SET identity_checked_at=0 WHERE identity_hash=?`).bind(identityHash),
  ]);
}

export async function getHumanSession(request: Request, env: AuthEnv): Promise<HumanSession | null> {
  if (authProvider(env)==="clerk") {
    try { return await getClerkSession(request,env); }
    catch(error) { if (error instanceof ClerkAuthError) fail(error.status,error.code,error.message); if (error instanceof AuthError) throw error; fail(503,"temporarily_unavailable","Sign-in verification is temporarily unavailable."); }
  }
  const token = readCookie(request,"session");
  if (!token || token.length > 200) return null;
  const sessionHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT s.csrf_token,u.id,u.email,u.name,u.workspace_id,w.name AS workspace_name FROM auth_sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE s.token_hash=? AND s.expires_at>? AND s.provider='google' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=u.id)`).bind(sessionHash,Date.now()).first<{csrf_token:string;id:string;email:string;name:string;workspace_id:string;workspace_name:string}>();
  if (!row || !(await workspaceAccountAllowed(env,row.workspace_id))) return null;
  return {userId:row.id,email:row.email,name:row.name,workspaceId:row.workspace_id,workspaceName:row.workspace_name,csrfToken:row.csrf_token,sessionHash};
}

export async function requireSessionCsrf(request: Request, session: HumanSession, formToken?: string | null, env?: AuthEnv): Promise<void> {
  const originHeader = request.headers.get("Origin");
  const expected = env ? deploymentOrigins(env,origin(request,env)).frontendOrigin : new URL(request.url).origin;
  if (originHeader !== expected) fail(403,"csrf_failed","This request must come from your relay workspace.");
  const token = formToken ?? request.headers.get("X-CSRF-Token");
  if (!token || !(await safeEqual(token,session.csrfToken))) fail(403,"csrf_failed","Refresh the workspace and try again.");
}

async function userForIdentity(env: AuthEnv, subject: string, email: string, provider: "google"|"dev"|"clerk"=subject.startsWith("dev:") ? "dev" : "google", issuer=provider==="dev" ? "local" : "https://accounts.google.com", securityVersion=0): Promise<User> {
  const key=JSON.stringify([provider,issuer,subject]);
  const identityHash=await sha256(key);
  if (provider==="clerk" && await env.DB.prepare(`SELECT 1 FROM identity_tombstones WHERE identity_hash=?`).bind(await sha256(key)).first()) fail(403,"account_deleted","This account has been deleted.");
  if (isHosted(env) && provider!=="clerk" && await env.DB.prepare(`SELECT 1 FROM identity_signup_cooldowns WHERE identity_hash=? AND expires_at>?`).bind(identityHash,Date.now()).first()) fail(429,"signup_cooldown","This deleted account can create a new workspace after the 30-day account cooldown.");
  email = email.trim().toLowerCase();
  let user = await env.DB.prepare(`SELECT * FROM users WHERE identity_key=? OR (identity_key IS NULL AND google_sub=?)`).bind(key,provider==="clerk" ? "clerk:"+identityHash : subject).first<User>();
  if (!approvedEmail(env,email)) {
    if (user) await env.DB.prepare(`UPDATE workspaces SET identity_restricted=1 WHERE id=?`).bind(user.workspace_id).run();
    fail(403,"invite_required","This deployment requires an invitation for your email address.");
  }
  if (user) {
    if (await env.DB.prepare(`SELECT 1 FROM account_deletions WHERE user_id=?`).bind(user.id).first()) fail(403,"account_deleted","This account is being deleted.");
    if (provider==="clerk") {
      const currentVersion=(await env.DB.prepare(`SELECT version FROM identity_security WHERE identity_hash=?`).bind(identityHash).first<IdentitySecurity>())?.version ?? 0;
      if (currentVersion!==securityVersion) fail(403,"account_restricted","Account status changed. Sign in again.");
    }
    await env.DB.batch([
      env.DB.prepare(`UPDATE identity_security SET restricted=0,reason='verified',updated_at=? WHERE identity_hash=? AND version=?`).bind(Date.now(),identityHash,securityVersion),
      env.DB.prepare(`UPDATE users SET email=?1,identity_checked_at=?2,identity_key=?3,identity_hash=?4 WHERE id=?5
        AND NOT EXISTS(SELECT 1 FROM identity_security WHERE identity_hash=?4 AND (version<>?6 OR restricted=1))`).bind(email,Date.now(),key,identityHash,user.id,securityVersion),
      env.DB.prepare(`UPDATE workspaces SET identity_restricted=0 WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM identity_security WHERE identity_hash=?2 AND (version<>?3 OR restricted=1))`).bind(user.workspace_id,identityHash,securityVersion),
    ]);
    if (!(await workspaceAccountAllowed(env,user.workspace_id))) fail(403,"account_restricted","This account is restricted.");
    return {...user,email};
  }
  const id = ulid(), workspaceId = "ws_" + ulid(), now = Date.now(), name = email.split("@")[0];
  const configuredLimit = (value: string | undefined, fallback: number): number => {
    const n = Number(value);
    return value && Number.isSafeInteger(n) && n > 0 ? n : fallback;
  };
  const workspaceLimit=env.HOSTED_WORKSPACE_LIMIT!==undefined && /^\d+$/.test(env.HOSTED_WORKSPACE_LIMIT)
    ? Math.min(10000,Number(env.HOSTED_WORKSPACE_LIMIT)) : 150;
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE identity_security SET restricted=0,reason='verified',updated_at=? WHERE identity_hash=? AND version=?`).bind(now,identityHash,securityVersion),
      env.DB.prepare(`INSERT INTO workspaces(id,name,created_at,daily_job_limit,monthly_job_limit,storage_limit_bytes,next_release_beta)
        SELECT ?1,?2,?3,?4,?5,?10,?11 WHERE (?6=0 OR (SELECT COUNT(*) FROM workspaces WHERE id<>'default')<?7)
        AND NOT EXISTS(SELECT 1 FROM identity_security WHERE identity_hash=?8 AND (version<>?9 OR restricted=1))`).bind(workspaceId,"My agents",now,configuredLimit(env.DEFAULT_DAILY_JOB_LIMIT,50),configuredLimit(env.DEFAULT_MONTHLY_JOB_LIMIT,500),isHosted(env)?1:0,workspaceLimit,identityHash,securityVersion,configuredLimit(env.DEFAULT_STORAGE_LIMIT_BYTES,DEFAULT_HOSTED_STORAGE_LIMIT_BYTES),isHosted(env) && env.NEXT_RELEASE_DEFAULT_ENABLED==="true" ? 1 : 0),
      env.DB.prepare(`INSERT INTO users(id,google_sub,identity_key,identity_hash,email,name,workspace_id,created_at,identity_checked_at)
        SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9 WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=?7)`).bind(id,provider==="clerk" ? "clerk:"+identityHash : subject,key,identityHash,email,name,workspaceId,now,now),
    ]);
    if (!(await env.DB.prepare(`SELECT id FROM users WHERE id=?`).bind(id).first())) fail(429,"signup_capacity","New account signup is temporarily at capacity.");
    return {id,identity_key:key,email,name,workspace_id:workspaceId,identity_checked_at:now};
  } catch (error) {
    user = await env.DB.prepare(`SELECT * FROM users WHERE identity_key=?`).bind(key).first<User>();
    if (!user) throw error;
    if (!(await workspaceAccountAllowed(env,user.workspace_id))) fail(403,"account_restricted","This account is restricted.");
    return user;
  }
}
async function createSession(request: Request, env: AuthEnv, user: User): Promise<string> {
  const token = randomToken("ses_",32), now = Date.now();
  const old = readCookie(request,"session");
  const statements: D1PreparedStatement[] = [];
  if (old) statements.push(env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash=?`).bind(await sha256(old)));
  statements.push(env.DB.prepare(`INSERT INTO auth_sessions(token_hash,user_id,csrf_token,created_at,expires_at)
    SELECT ?1,?2,?3,?4,?5 WHERE (SELECT COUNT(*) FROM auth_sessions WHERE user_id=?2)<20
      AND EXISTS(SELECT 1 FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=?2 AND w.security_suspended=0 AND w.identity_restricted=0)
      AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?2)`).bind(await sha256(token),user.id,randomToken("csrf_",32),now,now + 7 * DAY));
  const written=await env.DB.batch(statements);
  if (!written[written.length-1].meta.changes) fail(429,"session_limit","Too many active sessions. Sign out of another device and try again.");
  return cookie(request,"session",token,7 * 86400);
}
export function loginConfigured(env: AuthEnv): boolean {
  if (signupMode(env)==="invite" && !(env.BETA_EMAILS ?? "").trim()) return false;
  if (authProvider(env)==="clerk") { try { clerkConfiguration(env); return true; } catch { return false; } }
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.PUBLIC_URL);
}
function publicAuthConfig(env: AuthEnv, base: string) {
  const provider=authProvider(env), configured=loginConfigured(env);
  const {apiOrigin,frontendOrigin,split}=deploymentOrigins(env,base);
  return {authProvider:provider,loginConfigured:configured,loginUrl:split ? frontendOrigin+"/sign-in" : "/auth/start",apiOrigin,frontendOrigin,...(provider==="clerk" && configured ? clerkConfiguration(env) : {})};
}
export function clerkUi(env: AuthEnv, returnTo: string): ClerkUiConfig {
  return {...clerkConfiguration(env),nonce:randomToken("",24),returnTo:safeReturn(returnTo,new URL(env.PUBLIC_URL!).origin)};
}
async function getClerkSession(request: Request, env: AuthEnv): Promise<HumanSession|null> {
  if (!loginConfigured(env)) return null;
  const identity=await clerkIdentity(request,env);
  if (!identity) return null;
  const key=JSON.stringify(["clerk",identity.issuer,identity.subject]), sessionHash=await sha256(JSON.stringify(["clerk-session",identity.issuer,identity.sessionId]));
  if (await env.DB.prepare(`SELECT 1 FROM clerk_session_revocations WHERE session_hash=?`).bind(sessionHash).first()) return null;
  const identityHash=await sha256(key);
  if (await env.DB.prepare(`SELECT 1 FROM identity_tombstones WHERE identity_hash=?`).bind(identityHash).first()) return null;
  let user=await env.DB.prepare(`SELECT * FROM users WHERE identity_key=?`).bind(key).first<User>();
  const security=await env.DB.prepare(`SELECT restricted,version FROM identity_security WHERE identity_hash=?`).bind(identityHash).first<IdentitySecurity>();
  const allowed=user ? await workspaceAccountAllowed(env,user.workspace_id) : false;
  if (!user || !allowed || security?.restricted || user.identity_checked_at < Date.now()-300_000) {
    let email: string;
    try { email=await clerkVerifiedEmail(env,identity.subject); }
    catch (error) {
      if (error instanceof ClerkAuthError && error.status===403) await restrictIdentityAccess(env,identityHash,"provider",user?.id);
      throw error;
    }
    // The version was observed before the provider read. A webhook received
    // during that read cannot be undone by its delayed successful response.
    user=await userForIdentity(env,identity.subject,email,"clerk",identity.issuer,security?.version ?? 0);
  }
  if (!(await workspaceAccountAllowed(env,user.workspace_id))) return null;
  if (await env.DB.prepare(`SELECT 1 FROM account_deletions WHERE user_id=?`).bind(user.id).first()) return null;
  // This row holds consent/CSRF state only. Every request above verifies the
  // current Clerk token; knowing this row's hash cannot authenticate a user.
  await env.DB.prepare(`INSERT OR IGNORE INTO auth_sessions(token_hash,user_id,csrf_token,created_at,expires_at,provider,provider_session_id)
    SELECT ?1,?2,?3,?4,?5,'clerk',?6 WHERE (SELECT COUNT(*) FROM auth_sessions WHERE user_id=?2)<20
      AND EXISTS(SELECT 1 FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=?2 AND w.security_suspended=0 AND w.identity_restricted=0)
      AND NOT EXISTS(SELECT 1 FROM clerk_session_revocations WHERE session_hash=?1)`).bind(sessionHash,user.id,randomToken("csrf_",32),Date.now(),Date.now()+7*DAY,identity.sessionId).run();
  const row=await env.DB.prepare(`SELECT s.csrf_token,w.name AS workspace_name FROM auth_sessions s JOIN workspaces w ON w.id=? WHERE s.token_hash=? AND s.user_id=? AND w.security_suspended=0 AND w.identity_restricted=0 AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM clerk_session_revocations WHERE session_hash=?)`).bind(user.workspace_id,sessionHash,user.id,user.id,sessionHash).first<{csrf_token:string;workspace_name:string}>();
  if (!row) return null;
  return {userId:user.id,email:user.email,name:user.name,workspaceId:user.workspace_id,workspaceName:row.workspace_name,csrfToken:row.csrf_token,sessionHash,provider:"clerk",providerSessionId:identity.sessionId};
}

async function googleStart(request: Request, env: AuthEnv): Promise<Response> {
  const base = origin(request,env);
  if (!loginConfigured(env)) return html(authMessage("Sign-in is not configured yet", signupMode(env) === "invite" ? "The owner needs to configure Google sign-in, the public relay URL, and invited email addresses." : "The owner needs to configure Google sign-in and the public relay URL."),503);
  await throttle(request,env,"login",20);
  const state = randomToken("",32), browser = randomToken("",32), verifier = randomToken("",48);
  const returnTo = safeReturn(new URL(request.url).searchParams.get("return_to"),base);
  const inserted=await env.DB.prepare(`INSERT INTO auth_login_states(state_hash,browser_hash,verifier,return_to,expires_at)
    SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM auth_login_states)<1000`).bind(await sha256(state),await sha256(browser),verifier,returnTo,Date.now() + 10 * 60_000).run();
  if (!inserted.meta.changes) fail(429,"login_capacity","Too many sign-in attempts. Try again later.");
  const url = new URL(GOOGLE_AUTHORIZE);
  for (const [k,v] of Object.entries({client_id:env.GOOGLE_CLIENT_ID!,redirect_uri:base + "/auth/google/callback",response_type:"code",scope:"openid email",state,code_challenge:await challenge(verifier),code_challenge_method:"S256",prompt:"select_account"})) url.searchParams.set(k,v);
  return redirect(url.toString(),[cookie(request,"login",browser,600)]);
}
async function googleCallback(request: Request, env: AuthEnv): Promise<Response> {
  const base = origin(request,env);
  if (!loginConfigured(env)) fail(503,"setup_required","Google sign-in has not been configured.");
  await throttle(request,env,"callback",30);
  const params = new URL(request.url).searchParams, state = params.get("state"), browser = readCookie(request,"login");
  if (!state || state.length > 200 || !browser) fail(400,"invalid_state","The sign-in request expired. Start again.");
  const row = await env.DB.prepare(`DELETE FROM auth_login_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING verifier,return_to`).bind(await sha256(state),await sha256(browser),Date.now()).first<{verifier:string;return_to:string}>();
  if (!row) fail(400,"invalid_state","The sign-in request expired or was already used. Start again.");
  const code = params.get("code");
  if (!code || code.length > 4096) fail(400,"login_canceled","Google sign-in was canceled or did not return a code.");
  // The code exchange and userinfo call use fixed Google endpoints and TLS.
  // No unverified JWT is decoded or used as identity, and provider tokens never persist.
  const tokenResponse = await fetch(GOOGLE_TOKEN,{method:"POST",redirect:"error",signal:AbortSignal.timeout(10_000),headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID!,client_secret:env.GOOGLE_CLIENT_SECRET!,redirect_uri:base + "/auth/google/callback",grant_type:"authorization_code",code_verifier:row.verifier})});
  if (!tokenResponse.ok) fail(400,"login_failed","Google could not complete sign-in. Start again.");
  const token = await tokenResponse.json<{access_token?:string}>();
  if (!token.access_token) fail(400,"login_failed","Google did not return an access token.");
  const infoResponse = await fetch(GOOGLE_USERINFO,{redirect:"error",signal:AbortSignal.timeout(10_000),headers:{Authorization:`Bearer ${token.access_token}`}});
  if (!infoResponse.ok) fail(400,"login_failed","Google could not verify this account.");
  const info = await infoResponse.json<{sub?:string;email?:string;email_verified?:boolean}>();
  if (!info.sub || typeof info.sub !== "string" || !info.email || typeof info.email !== "string" || info.email_verified !== true) fail(403,"unverified_email","A verified Google email address is required.");
  const user = await userForIdentity(env,info.sub,info.email);
  return redirect(safeReturn(row.return_to,base),[await createSession(request,env,user),cookie(request,"login","",0)]);
}

function validRedirect(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const u = new URL(value);
    // Restrict host serialization to literal DNS/IP characters before it is
    // also used as the consent form's CSP callback destination.
    return !u.hash && !u.username && !u.password && /^(?:[a-z0-9._-]+|\[[a-f0-9:]+\])$/i.test(u.hostname) && (u.protocol === "https:" || (u.protocol === "http:" && localHost(u.hostname)));
  } catch { return false; }
}
async function register(request: Request, env: AuthEnv): Promise<Response> {
  await throttle(request,env,"register",10);
  if (!(request.headers.get("Content-Type") ?? "").startsWith("application/json")) fail(415,"invalid_client_metadata","Send JSON client metadata.");
  let body: Record<string,unknown>;
  try { body = JSON.parse(await limitedBody(request)); } catch (e) { if (e instanceof AuthError) throw e; fail(400,"invalid_client_metadata","Invalid client metadata."); }
  if (!body! || typeof body! !== "object" || Array.isArray(body!)) fail(400,"invalid_client_metadata","Invalid client metadata.");
  const redirects = body!.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 10 || !redirects.every(validRedirect)) fail(400,"invalid_redirect_uri","Register 1–10 HTTPS or loopback redirect URIs without fragments.");
  if (body!.token_endpoint_auth_method && body!.token_endpoint_auth_method !== "none") fail(400,"invalid_client_metadata","This server supports public clients with PKCE and token_endpoint_auth_method none.");
  if (body!.grant_types && (!Array.isArray(body!.grant_types) || !body!.grant_types.every((g) => ["authorization_code","refresh_token"].includes(g)))) fail(400,"invalid_client_metadata","Unsupported grant type.");
  if (body!.response_types && (!Array.isArray(body!.response_types) || body!.response_types.some((r) => r !== "code"))) fail(400,"invalid_client_metadata","Only authorization-code responses are supported.");
  const name = typeof body!.client_name === "string" ? body!.client_name.trim().slice(0,100) : "MCP client";
  const id = randomToken("client_",24), now = Date.now();
  // Public allocation uses its own small lane; exhausting registration must
  // not spend the authenticated allowance needed to refresh an existing grant.
  await assertAnonymousResourceOperation(env,now);
  const inserted=await env.DB.prepare(`INSERT INTO oauth_clients(id,name,redirect_uris,created_at)
    SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM oauth_clients)<1000`).bind(id,name || "MCP client",JSON.stringify([...new Set(redirects)]),now).run();
  if (!inserted.meta.changes) fail(429,"client_capacity","Client registration is temporarily at capacity.");
  return json({client_id:id,client_id_issued_at:Math.floor(now / 1000),client_name:name || "MCP client",redirect_uris:[...new Set(redirects)],token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"],response_types:["code"]},201);
}
function parseScope(value: string | null): string[] {
  const scopes = value == null || value === "" ? ALL_SCOPES : [...new Set(value.split(/\s+/).filter(Boolean))];
  if (scopes.some((s) => !ALL_SCOPES.includes(s))) fail(400,"invalid_scope","The requested permission is not supported.");
  if (!scopes.some((s) => s.startsWith("relay:"))) fail(400,"invalid_scope","Request at least one relay permission.");
  return scopes;
}
async function authorizationRequest(request: Request, env: AuthEnv): Promise<{client:Client;data:AuthRequest}> {
  const url = new URL(request.url), p = url.searchParams, base = origin(request,env);
  for (const key of p.keys()) if (p.getAll(key).length !== 1) fail(400,"invalid_request","Duplicate parameters are not allowed.");
  const clientId = p.get("client_id") ?? "", redirectUri = p.get("redirect_uri") ?? "";
  if (clientId.length > 200) fail(400,"invalid_client","Unknown client.");
  const client = await env.DB.prepare(`SELECT * FROM oauth_clients WHERE id=?`).bind(clientId).first<Client>();
  if (!client || !validRedirect(redirectUri) || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) fail(400,"invalid_client","The client or exact redirect URI is not registered.");
  if (p.get("response_type") !== "code") fail(400,"unsupported_response_type","Use the authorization-code flow.");
  const pkce = p.get("code_challenge") ?? "";
  if (p.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(pkce)) fail(400,"invalid_request","S256 PKCE is required.");
  const resource = p.get("resource") ?? base + "/mcp";
  if (resourceConnectionId(resource,base) === undefined) fail(400,"invalid_target","Request access only to this relay’s MCP resource.");
  const state = p.get("state") ?? "";
  if (state.length > 1024) fail(400,"invalid_request","State is too large.");
  return {client,data:{clientId,redirectUri,state,challenge:pkce,scope:parseScope(p.get("scope")).join(" "),resource}};
}
function returnToClient(data: AuthRequest, base: string, values: Record<string,string>, asJson = false): Response {
  const url = new URL(data.redirectUri);
  for (const [k,v] of Object.entries(values)) url.searchParams.set(k,v);
  if (data.state) url.searchParams.set("state",data.state);
  url.searchParams.set("iss",base);
  return asJson ? json({redirectUrl:url.toString()}) : redirect(url.toString());
}
async function authorizeGet(request: Request, env: AuthEnv): Promise<Response> {
  const {client,data} = await authorizationRequest(request,env);
  const url=new URL(request.url), returnTo=safeReturn(url.pathname+url.search,url.origin);
  const {frontendOrigin,split}=deploymentOrigins(env,url.origin);
  const asJson=split && wantsJson(request);
  const session = await getHumanSession(request,env);
  if (split && (!session || !asJson)) {
    if (asJson) fail(401,"login_required","Sign in again before connecting an agent.");
    const query=new URLSearchParams({response_type:"code",client_id:data.clientId,redirect_uri:data.redirectUri,code_challenge:data.challenge,code_challenge_method:"S256",scope:data.scope,resource:data.resource});
    if(data.state) query.set("state",data.state);
    return redirect(frontendOrigin+safeFrontendReturn("/connect?"+query,frontendOrigin));
  }
  if (!session) return redirect(`/auth/start?return_to=${encodeURIComponent(returnTo)}`);
  // Authentication has already succeeded from a verified cookie/bearer. A
  // clean navigation preserves those cookies without echoing a handshake.
  if (!asJson && returnTo!==url.pathname+url.search) return redirect(returnTo);
  await throttle(request,env,"consent",60);
  // The canonical resource carries a target chosen in Hitchhike. Client names
  // and provider labels are not identity evidence. Missing resource stays on
  // the compatible generic flow with an explicit owner choice.
  const targetAgentId = resourceConnectionId(data.resource,origin(request,env)) ?? null;
  const agents = await env.DB.prepare(`SELECT id,name,can_request,can_work FROM agents WHERE workspace_id=?1 AND (?2 IS NULL OR id=?2) ORDER BY name`).bind(session.workspaceId,targetAgentId).all<{id:string;name:string;can_request:number;can_work:number}>();
  if (targetAgentId && !agents.results.length) fail(403,"access_denied","This connection is unavailable in your workspace. Return to its setup page and sign in to the correct account.");
  const requestId = randomToken("consent_",32);
  const inserted=await env.DB.prepare(`INSERT INTO oauth_requests(id_hash,session_hash,payload,expires_at)
    SELECT ?1,?2,?3,?4 WHERE (SELECT COUNT(*) FROM oauth_requests WHERE session_hash=?2)<20
    AND (SELECT COUNT(*) FROM oauth_requests)<1000
    AND EXISTS(SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=u.workspace_id
      WHERE s.token_hash=?2 AND w.security_suspended=0 AND w.identity_restricted=0)`).bind(await sha256(requestId),session.sessionHash,JSON.stringify(data),Date.now() + 10 * 60_000).run();
  if (!inserted.meta.changes) fail(429,"consent_capacity","Too many pending connections. Try again later.");
  const redirectOrigin = new URL(data.redirectUri).origin;
  const consent={clientName:client.name,redirectOrigin,email:session.email,csrfToken:session.csrfToken,requestId,scopes:data.scope.split(" "),agents:agents.results,targetAgentId};
  if(asJson) return json(consent);
  const clerk=authProvider(env)==="clerk" ? clerkUi(env,returnTo) : undefined;
  return html(consentPage({...consent,clerk}),200,redirectOrigin,clerk);
}
async function authorizePost(request: Request, env: AuthEnv): Promise<Response> {
  const base = origin(request,env);
  const {split}=deploymentOrigins(env,base);
  const body = await formBody(request);
  let identityRequest=request;
  if (authProvider(env)==="clerk" && body.has("clerk_session_token")) {
    if(split) fail(400,"invalid_request","Send the session token in the Authorization header.");
    if(request.headers.get("Origin")!==base) fail(403,"csrf_failed","This request must come from your relay workspace.");
    const h=new Headers(request.headers);h.set("Authorization",`Bearer ${body.get("clerk_session_token")}`);
    identityRequest=new Request(request.url,{headers:h});
  }
  const session = await getHumanSession(identityRequest,env);
  if (!session) fail(401,"login_required","Sign in again before connecting an agent.");
  await requireSessionCsrf(request,session,body.get("csrf_token"),env);
  const id = body.get("request_id") ?? "";
  if (id.length > 200) fail(400,"invalid_request","Invalid consent request.");
  const row = await env.DB.prepare(`SELECT payload FROM oauth_requests WHERE id_hash=? AND session_hash=? AND expires_at>?`).bind(await sha256(id),session.sessionHash,Date.now()).first<{payload:string}>();
  if (!row) fail(400,"invalid_request","This consent request expired or was already used.");
  const data = JSON.parse(row.payload) as AuthRequest;
  if (body.get("decision") === "deny") {
    await env.DB.prepare(`DELETE FROM oauth_requests WHERE id_hash=? AND session_hash=?`).bind(await sha256(id),session.sessionHash).run();
    return returnToClient(data,base,{error:"access_denied"},split && wantsJson(request));
  }
  if (body.get("decision") !== "allow") fail(400,"invalid_request","Choose whether to connect this client.");
  const targetAgentId = resourceConnectionId(data.resource,base);
  if (targetAgentId === undefined) fail(400,"invalid_target","This consent request has an invalid MCP resource.");
  if (targetAgentId && body.has("agent_id") && body.get("agent_id") !== targetAgentId) fail(403,"access_denied","This authorization belongs to a different connection. Restart setup for the connection you want to use.");
  const agent = await env.DB.prepare(`SELECT a.* FROM agents a JOIN workspaces w ON w.id=a.workspace_id WHERE a.id=? AND a.workspace_id=? AND w.paused=0`).bind(targetAgentId ?? body.get("agent_id") ?? "",session.workspaceId).first<TenantAgent>();
  if (!agent) fail(403,"access_denied","Choose an active connection in your own workspace.");
  const scopes = effectiveScopes(data.scope,agent);
  if (!scopes.some((s) => s.startsWith("relay:"))) fail(403,"access_denied","This connection does not support the requested permissions.");
  const consumed = await env.DB.prepare(`DELETE FROM oauth_requests WHERE id_hash=? AND session_hash=? AND expires_at>? RETURNING id_hash`).bind(await sha256(id),session.sessionHash,Date.now()).first();
  if (!consumed) fail(400,"invalid_request","This consent request was already used.");
  const grantId = ulid(), code = randomToken("code_",32), now = Date.now();
  const written=await env.DB.batch([
    env.DB.prepare(`INSERT INTO oauth_grants(id,user_id,workspace_id,agent_id,auth_generation,client_id,scope,resource,created_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9 WHERE (SELECT COUNT(*) FROM oauth_grants WHERE user_id=?2)<50
        AND EXISTS(SELECT 1 FROM agents a JOIN workspaces w ON w.id=a.workspace_id JOIN users u ON u.workspace_id=w.id
          WHERE a.id=?4 AND a.workspace_id=?3 AND a.auth_generation=?5 AND u.id=?2 AND w.security_suspended=0 AND w.identity_restricted=0)
        AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?2)`).bind(grantId,session.userId,session.workspaceId,agent.id,agent.auth_generation,data.clientId,scopes.join(" "),data.resource,now),
    env.DB.prepare(`INSERT INTO oauth_codes(code_hash,grant_id,redirect_uri,code_challenge,expires_at)
      SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM oauth_grants WHERE id=?2)`).bind(await sha256(code),grantId,data.redirectUri,data.challenge,now + 60_000),
  ]);
  if (!written[0].meta.changes) fail(429,"grant_capacity","This account cannot add another connection right now.");
  return returnToClient(data,base,{code},split && wantsJson(request));
}
async function activeGrant(env: AuthEnv, grantId: string): Promise<{grant:Grant;agent:TenantAgent} | null> {
  // Pausing stops new work at the task/claim boundary; it must not prevent
  // users reading results or workers returning already-running work.
  const grant = await env.DB.prepare(`SELECT g.* FROM oauth_grants g JOIN users u ON u.id=g.user_id AND u.workspace_id=g.workspace_id JOIN workspaces w ON w.id=g.workspace_id WHERE g.id=? AND g.revoked_at IS NULL`).bind(grantId).first<Grant>();
  if (!grant) return null;
  const user = await env.DB.prepare(`SELECT email FROM users WHERE id=? AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=users.id)`).bind(grant.user_id).first<{email:string}>();
  if (!user || !(await workspaceAccountAllowed(env,grant.workspace_id))) return null;
  const agent = await env.DB.prepare(`SELECT * FROM agents WHERE id=? AND workspace_id=? AND auth_generation=?`).bind(grant.agent_id,grant.workspace_id,grant.auth_generation).first<TenantAgent>();
  return agent ? {grant,agent} : null;
}
type TokenSource = {kind:"code"|"refresh";hash:string};
async function issueTokens(env: AuthEnv, grant: Grant, agent: TenantAgent, source: TokenSource, scope=effectiveScopes(grant.scope,agent).join(" ")): Promise<Response> {
  const now = Date.now(), access = randomToken("access_",32), refresh = grant.scope.split(" ").includes("offline_access") ? randomToken("refresh_",32) : null;
  const accessHash=await sha256(access), redemptionId=randomToken("",24);
  const sourceTable=source.kind==="code" ? "oauth_codes" : "oauth_tokens", sourceKey=source.kind==="code" ? "code_hash" : "token_hash";
  // Charge only verified credentials, never anonymous token guesses. A budget
  // rejection happens before consumption so the same credential can be retried.
  await assertResourceOperation(env,grant.workspace_id,{cost:1,essential:true},now);
  // A normal client rotating every fifteen minutes fits a month of spent
  // refresh hashes. Prune only expired capabilities; an unexpired spent refresh
  // hash is always retained for replay detection. Consumption and both outputs
  // share one transaction, so capacity errors and failed writes cannot burn the
  // caller's only refresh token. The random marker prevents same-ms races.
  const statements = [
    env.DB.prepare(`DELETE FROM oauth_tokens WHERE grant_id=? AND expires_at<=?`).bind(grant.id,now),
    env.DB.prepare(`UPDATE ${sourceTable} SET used_at=?1,redemption_id=?2 WHERE ${sourceKey}=?3 AND grant_id=?4 AND used_at IS NULL AND expires_at>?1
      AND (SELECT COUNT(*) FROM oauth_tokens WHERE grant_id=?4)<?5
      AND EXISTS(SELECT 1 FROM oauth_grants g JOIN agents a ON a.id=g.agent_id AND a.workspace_id=g.workspace_id
        JOIN workspaces w ON w.id=g.workspace_id WHERE g.id=?4 AND g.revoked_at IS NULL
          AND a.auth_generation=g.auth_generation AND w.security_suspended=0 AND w.identity_restricted=0)
      AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=(SELECT user_id FROM oauth_grants WHERE id=?4))`).bind(now,redemptionId,source.hash,grant.id,refresh ? 4095 : 4096),
    env.DB.prepare(`INSERT INTO oauth_tokens(token_hash,grant_id,kind,created_at,expires_at,scope)
      SELECT ?1,?2,'access',?3,?4,?5 WHERE EXISTS(SELECT 1 FROM ${sourceTable} WHERE ${sourceKey}=?6 AND redemption_id=?7)`).bind(accessHash,grant.id,now,now + ACCESS_SECONDS * 1000,scope,source.hash,redemptionId),
  ];
  if (refresh) statements.push(env.DB.prepare(`INSERT INTO oauth_tokens(token_hash,grant_id,kind,created_at,expires_at,scope)
    SELECT ?1,?2,'refresh',?3,?4,?5 WHERE EXISTS(SELECT 1 FROM oauth_tokens WHERE token_hash=?6)`).bind(await sha256(refresh),grant.id,now,now + 30 * DAY,scope,accessHash));
  const written=await env.DB.batch(statements);
  if (!written[1].meta.changes) {
    const current=await env.DB.prepare(`SELECT used_at FROM ${sourceTable} WHERE ${sourceKey}=?`).bind(source.hash).first<{used_at:number|null}>();
    if (current?.used_at!==null && current?.used_at!==undefined) {
      await env.DB.prepare(`UPDATE oauth_grants SET revoked_at=? WHERE id=?`).bind(now,grant.id).run();
      fail(400,"invalid_grant","This credential was already used. Connect again.");
    }
    if (!current || !(await activeGrant(env,grant.id))) fail(400,"invalid_grant","This connection is no longer active. Connect again.");
    fail(429,"token_capacity","This connection has reached its token limit. Your credential remains valid: retry when old tokens expire, or reconnect to create a new grant.");
  }
  return json({access_token:access,token_type:"Bearer",expires_in:ACCESS_SECONDS,scope,...(refresh ? {refresh_token:refresh} : {})});
}
async function tokenEndpoint(request: Request, env: AuthEnv): Promise<Response> {
  await throttle(request,env,"token",120,60_000);
  const body = await formBody(request), clientId = body.get("client_id") ?? "", now = Date.now();
  if (!clientId || clientId.length > 200 || request.headers.has("Authorization") || body.has("client_secret")) fail(400,"invalid_client","Use the registered public client_id and PKCE; client secrets are not supported.");
  if (body.get("grant_type") === "authorization_code") {
    const code = body.get("code") ?? "", verifier = body.get("code_verifier") ?? "";
    if (code.length > 200 || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) fail(400,"invalid_grant","Invalid authorization code or verifier.");
    const hash = await sha256(code);
    const row = await env.DB.prepare(`SELECT * FROM oauth_codes WHERE code_hash=?`).bind(hash).first<{grant_id:string;redirect_uri:string;code_challenge:string;expires_at:number;used_at:number|null}>();
    const active = row ? await activeGrant(env,row.grant_id) : null;
    if (!row || !active || active.grant.client_id !== clientId || row.redirect_uri !== body.get("redirect_uri") || !(await safeEqual(row.code_challenge,await challenge(verifier)))) fail(400,"invalid_grant","The authorization code, client, redirect URI, or verifier is invalid.");
    if (body.has("resource") && body.get("resource") !== active.grant.resource) fail(400,"invalid_target","The resource does not match this authorization.");
    if (row.used_at !== null) {
      await env.DB.prepare(`UPDATE oauth_grants SET revoked_at=? WHERE id=?`).bind(now,active.grant.id).run();
      fail(400,"invalid_grant","This authorization code was already used. Connect again.");
    }
    if (row.expires_at <= now) fail(400,"invalid_grant","This authorization code expired. Connect again.");
    return issueTokens(env,active.grant,active.agent,{kind:"code",hash});
  }
  if (body.get("grant_type") === "refresh_token") {
    const token = body.get("refresh_token") ?? "";
    if (!token || token.length > 200) fail(400,"invalid_grant","Invalid refresh token.");
    const hash = await sha256(token);
    const row = await env.DB.prepare(`SELECT * FROM oauth_tokens WHERE token_hash=? AND kind='refresh'`).bind(hash).first<{grant_id:string;expires_at:number;used_at:number|null;scope:string|null}>();
    const active = row ? await activeGrant(env,row.grant_id) : null;
    if (!row || !active || active.grant.client_id !== clientId) fail(400,"invalid_grant","Invalid refresh token or client.");
    if (body.has("resource") && body.get("resource") !== active.grant.resource) fail(400,"invalid_target","The resource does not match this authorization.");
    const ceiling=(row.scope ?? active.grant.scope).split(" ").filter(s=>active.grant.scope.split(" ").includes(s));
    const requested=body.has("scope") ? [...new Set((body.get("scope") ?? "").split(/\s+/).filter(Boolean))] : ceiling;
    if (!requested.length || requested.some(s=>!ALL_SCOPES.includes(s) || !ceiling.includes(s))) fail(400,"invalid_scope","Refresh permissions must be a subset of this refresh token's permissions.");
    const scopes=effectiveScopes(requested.join(" "),active.agent);
    if (!scopes.some(s=>s.startsWith("relay:"))) fail(400,"invalid_scope","This connection has no current relay permission. Restore its role or connect again.");
    if (row.used_at !== null) {
      await env.DB.prepare(`UPDATE oauth_grants SET revoked_at=? WHERE id=?`).bind(now,active.grant.id).run();
      fail(400,"invalid_grant","Refresh token reuse detected. Connect again.");
    }
    if (row.expires_at <= now) fail(400,"invalid_grant","Refresh token expired. Connect again.");
    return issueTokens(env,active.grant,active.agent,{kind:"refresh",hash},scopes.join(" "));
  }
  fail(400,"unsupported_grant_type","Use authorization_code or refresh_token.");
}

export async function authenticateOAuth(request: Request, env: AuthEnv): Promise<OAuthIdentity | null> {
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token?.startsWith("access_") || token.length > 200) return null;
  const row = await env.DB.prepare(`SELECT grant_id,scope FROM oauth_tokens WHERE token_hash=? AND kind='access' AND expires_at>?`).bind(await sha256(token),Date.now()).first<{grant_id:string;scope:string|null}>();
  const active = row ? await activeGrant(env,row.grant_id) : null;
  if (!active) return null;
  const base = origin(request,env), targetAgentId = resourceConnectionId(active.grant.resource,base);
  if (targetAgentId === undefined || (targetAgentId && targetAgentId !== active.agent.id)) return null;
  const path = new URL(request.url).pathname;
  // MCP tokens are bound to the exact advertised resource, including the
  // connection path. Existing authenticated HTTP APIs retain grant identity.
  if ((path === "/mcp" || path.startsWith("/mcp/")) && active.grant.resource !== base + path) return null;
  const scope=(row!.scope ?? active.grant.scope).split(" ").filter(s=>active.grant.scope.split(" ").includes(s)).join(" ");
  return {workspaceId:active.grant.workspace_id,agent:active.agent,scopes:effectiveScopes(scope,active.agent)};
}
export function oauthChallenge(request: Request, env: AuthEnv): string {
  const path = new URL(request.url).pathname;
  return `Bearer resource_metadata="${origin(request,env)}/.well-known/oauth-protected-resource${mcpConnectionId(path) ? path : "/mcp"}"`;
}
async function revokeEndpoint(request: Request, env: AuthEnv): Promise<Response> {
  await throttle(request,env,"revoke",120,60_000);
  const body = await formBody(request), token = body.get("token") ?? "", clientId = body.get("client_id") ?? "";
  if (token.length > 200 || !clientId || clientId.length > 200) fail(400,"invalid_request","Provide a token and registered client_id.");
  await env.DB.prepare(`UPDATE oauth_grants SET revoked_at=? WHERE client_id=? AND id IN (SELECT grant_id FROM oauth_tokens WHERE token_hash=?)`).bind(Date.now(),clientId,await sha256(token)).run();
  return json({});
}

/** Root calls this before protected API routes; errors never expose tokens. */
export async function handleAuth(request: Request, env: AuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const recognized = path.startsWith("/auth/") || path.startsWith("/oauth/") || path.startsWith("/.well-known/oauth-");
  if (!recognized) return null;
  if (!isHosted(env)) return json({error:"not_found"},404);
  let splitFrontend=false;
  const errorResponse = (code: string, message: string, status: number) => json(
    splitFrontend && wantsJson(request) && (path.startsWith("/auth/") || path === "/oauth/authorize")
      ? {error:{code,message}} : {error:code,error_description:message},status);
  try {
    const base = origin(request,env);
    const {frontendOrigin,split}=deploymentOrigins(env,base);
    splitFrontend=split;
    if (request.method==="GET" && path==="/auth/config") return json(publicAuthConfig(env,base));
    if (split && request.method==="GET" && (path==="/auth/start" || path==="/auth/clerk/start")) {
      const returnTo=safeFrontendReturn(new URL(request.url).searchParams.get("return_to"),frontendOrigin);
      return redirect(frontendOrigin+"/sign-in?"+new URLSearchParams({return_to:returnTo}));
    }
    if (request.method==="GET" && path==="/auth/start") return redirect(`/auth/${authProvider(env)==="clerk" ? "clerk" : "google"}/start?return_to=${encodeURIComponent(safeReturn(new URL(request.url).searchParams.get("return_to"),base))}`);
    if (request.method==="GET" && path==="/auth/clerk/start") {
      if (authProvider(env)!=="clerk") return json({error:"not_found"},404);
      if (!loginConfigured(env)) return html(authMessage("Sign-in is not configured yet","The owner needs to configure Clerk sign-in and the public relay URL."),503);
      const config=clerkUi(env,safeReturn(new URL(request.url).searchParams.get("return_to"),base));
      return html(clerkSignInPage(config),200,undefined,config);
    }
    if (path.startsWith("/auth/google/") && authProvider(env)!=="google") return json({error:"not_found"},404);
    if (request.method==="POST" && path==="/auth/clerk/webhook") {
      if (authProvider(env)!=="clerk") return json({error:"not_found"},404);
      const raw=await limitedBody(request);
      const event=await clerkWebhook(new Request(request.url,{method:"POST",headers:request.headers,body:raw}),env);
      if ((event.type==="session.ended" || event.type==="session.revoked" || event.type==="session.removed") && event.data.id) {
        const hash=await sha256(JSON.stringify(["clerk-session",clerkConfiguration(env).frontendApi,event.data.id]));
        await env.DB.batch([
          env.DB.prepare(`INSERT OR IGNORE INTO clerk_session_revocations(session_hash,created_at) VALUES (?,?)`).bind(hash,Date.now()),
          env.DB.prepare(`DELETE FROM oauth_requests WHERE session_hash=?`).bind(hash),
          env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash=?`).bind(hash),
        ]);
      }
      if ((event.type==="user.deleted" || event.type==="user.updated") && event.data.id) {
        const key=JSON.stringify(["clerk",clerkConfiguration(env).frontendApi,event.data.id]);
        const user=await env.DB.prepare(`SELECT * FROM users WHERE identity_key=?`).bind(key).first<User>();
        if (event.type==="user.deleted") {
          await env.DB.prepare(`INSERT OR IGNORE INTO identity_tombstones(identity_hash,created_at) VALUES (?,?)`).bind(await sha256(key),Date.now()).run();
          if(user) await deleteHumanAccount(env,user.id,user.workspace_id);
        } else {
          const identityHash=await sha256(key);
          const primary=event.data.email_addresses.find(e=>e.id===event.data.primary_email_address_id);
          if(event.data.banned || event.data.locked || !primary || primary.verification?.status!=="verified") await restrictIdentityAccess(env,identityHash,"provider",user?.id);
          else if (!approvedEmail(env,primary.email_address.trim().toLowerCase())) await restrictIdentityAccess(env,identityHash,"invite",user?.id);
          else await env.DB.batch([
            // Safe-looking webhooks may arrive late. They invalidate a pending
            // profile check but never clear a restriction or restore access.
            env.DB.prepare(`INSERT INTO identity_security(identity_hash,restricted,version,reason,updated_at) VALUES (?,0,1,'profile_changed',?)
              ON CONFLICT(identity_hash) DO UPDATE SET version=version+1,updated_at=excluded.updated_at`).bind(identityHash,Date.now()),
            env.DB.prepare(`UPDATE users SET identity_checked_at=0 WHERE identity_key=?`).bind(key),
          ]);
        }
      }
      return json({ok:true});
    }
    if (request.method === "GET" && path.startsWith("/.well-known/oauth-protected-resource")) {
      const resourcePath = path.slice("/.well-known/oauth-protected-resource".length) || "/mcp";
      if (resourcePath !== "/mcp" && !mcpConnectionId(resourcePath)) return json({error:"not_found"},404);
      // Deliberately no lookup: discovery reveals neither names nor existence.
      return json({resource:base + resourcePath,authorization_servers:[base],scopes_supported:ALL_SCOPES,bearer_methods_supported:["header"]});
    }
    if (request.method === "GET" && path === "/.well-known/oauth-authorization-server") return json({issuer:base,authorization_endpoint:base + "/oauth/authorize",token_endpoint:base + "/oauth/token",registration_endpoint:base + "/oauth/register",revocation_endpoint:base + "/oauth/revoke",response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],token_endpoint_auth_methods_supported:["none"],revocation_endpoint_auth_methods_supported:["none"],code_challenge_methods_supported:["S256"],scopes_supported:ALL_SCOPES,authorization_response_iss_parameter_supported:true});
    if ((request.method === "GET" && path === "/auth/session") || (request.method==="POST" && path==="/auth/clerk/session" && authProvider(env)==="clerk")) {
      if(request.method==="POST" && request.headers.get("Origin")!==frontendOrigin) fail(403,"csrf_failed","This request must come from your relay workspace.");
      const session = await getHumanSession(request,env);
      return json(session ? {authenticated:true,user:{id:session.userId,email:session.email,name:session.name},workspace:{id:session.workspaceId,name:session.workspaceName},csrfToken:session.csrfToken,...publicAuthConfig(env,base)} : {authenticated:false,...publicAuthConfig(env,base)},!session && request.method==="POST" ? 401 : 200);
    }
    if (request.method === "GET" && path === "/auth/google/start") return await googleStart(request,env);
    if (request.method === "GET" && path === "/auth/google/callback") return await googleCallback(request,env);
    if (request.method === "POST" && path === "/auth/logout") {
      const session = await getHumanSession(request,env);
      if (!session) return json({ok:true},200,{"Set-Cookie":cookie(request,"session","",0)});
      await requireSessionCsrf(request,session,undefined,env);
      if(session.provider==="clerk") {
        const action=await pendingClerkAction(env,"revoke_session",session.providerSessionId!,clerkConfiguration(env).frontendApi);
        await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO clerk_session_revocations(session_hash,created_at) VALUES (?,?)`).bind(session.sessionHash,Date.now()),action.statement]);
        await runClerkAction(env,action.id);
      }
      await env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash=?`).bind(session.sessionHash).run();
      await env.DB.prepare(`DELETE FROM oauth_requests WHERE session_hash=?`).bind(session.sessionHash).run();
      return json({ok:true},200,{"Set-Cookie":cookie(request,"session","",0)});
    }
    if (path === "/auth/dev" && ["GET","POST"].includes(request.method)) {
      if (env.ALLOW_DEV_AUTH !== "true" || !loopback(request) || authProvider(env)!=="google") return json({error:"not_found"},404);
      if (request.method === "GET") return html(devLoginPage());
      if (request.headers.get("Origin") !== base) return json({error:"not_found"},404);
      const isForm = (request.headers.get("Content-Type") ?? "").startsWith("application/x-www-form-urlencoded");
      if (!isForm && !(request.headers.get("Content-Type") ?? "").startsWith("application/json")) fail(415,"invalid_request","Send JSON or a form.");
      const body = isForm ? {email:(await formBody(request)).get("email")} : JSON.parse(await limitedBody(request)) as {email?:unknown};
      if (typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254) fail(400,"invalid_request","Supply a test email address.");
      const user = await userForIdentity(env,"dev:" + body.email.toLowerCase(),body.email);
      const sessionCookie = await createSession(request,env,user);
      return isForm ? redirect("/",[sessionCookie]) : json({ok:true},200,{"Set-Cookie":sessionCookie});
    }
    if (request.method === "POST" && path === "/oauth/register") return await register(request,env);
    if (request.method === "GET" && path === "/oauth/authorize") return await authorizeGet(request,env);
    if (request.method === "POST" && path === "/oauth/authorize") return await authorizePost(request,env);
    if (request.method === "POST" && path === "/oauth/token") return await tokenEndpoint(request,env);
    if (request.method === "POST" && path === "/oauth/revoke") return await revokeEndpoint(request,env);
    if (path === "/auth/grants") {
      const session = await getHumanSession(request,env);
      if (!session) fail(401,"login_required","Sign in to manage connected clients.");
      if (request.method === "GET") {
        const rows = await env.DB.prepare(`SELECT g.id,g.agent_id,g.scope,g.created_at,c.name AS client_name FROM oauth_grants g JOIN oauth_clients c ON c.id=g.client_id WHERE g.user_id=? AND g.revoked_at IS NULL ORDER BY g.created_at DESC`).bind(session.userId).all();
        return json({grants:rows.results});
      }
      if (request.method === "POST") {
        await requireSessionCsrf(request,session,undefined,env);
        const body = JSON.parse(await limitedBody(request)) as {id?:unknown};
        if (typeof body.id !== "string" || body.id.length > 200) fail(400,"invalid_request","Select a grant to disconnect.");
        await env.DB.prepare(`UPDATE oauth_grants SET revoked_at=? WHERE id=? AND user_id=?`).bind(Date.now(),body.id,session.userId).run();
        return json({ok:true});
      }
    }
    return json({error:"not_found"},404);
  } catch (error) {
    if(error instanceof ClerkAuthError) return errorResponse(error.code,error.message,error.status);
    if(error instanceof ResourceBudgetError) return errorResponse(error.code,error.message,error.status);
    if (error instanceof AuthError) {
      if ((!splitFrontend || !wantsJson(request)) && (path.startsWith("/auth/google/") || (path === "/oauth/authorize" && request.method === "GET"))) return html(authMessage("Connection needs attention",error.message),error.status);
      return errorResponse(error.code,error.message,error.status);
    }
    if (error instanceof OriginConfigurationError) return errorResponse("setup_required",error.message,503);
    if (error instanceof SyntaxError) return errorResponse("invalid_request","Invalid request body.",400);
    // Do not log upstream errors: they can contain provider URLs or credentials.
    return errorResponse("temporarily_unavailable","Authentication is temporarily unavailable. Try again later.",503);
  }
}

/** Called by scheduled maintenance; keeps spent refresh hashes for reuse detection. */
export async function cleanupAuth(env: AuthEnv, now = Date.now()): Promise<void> {
  if (!isHosted(env)) return;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM auth_sessions WHERE expires_at<?`).bind(now),
    env.DB.prepare(`DELETE FROM auth_login_states WHERE expires_at<?`).bind(now),
    env.DB.prepare(`DELETE FROM oauth_requests WHERE expires_at<?`).bind(now),
    env.DB.prepare(`DELETE FROM oauth_codes WHERE expires_at<?`).bind(now - DAY),
    env.DB.prepare(`DELETE FROM oauth_tokens WHERE (kind='access' AND expires_at<?) OR (kind='refresh' AND expires_at<?)`).bind(now-DAY,now),
    env.DB.prepare(`DELETE FROM oauth_codes WHERE grant_id IN (SELECT id FROM oauth_grants WHERE revoked_at<?)`).bind(now-DAY),
    env.DB.prepare(`DELETE FROM oauth_tokens WHERE grant_id IN (SELECT id FROM oauth_grants WHERE revoked_at<?)`).bind(now-DAY),
    env.DB.prepare(`DELETE FROM oauth_grants WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM oauth_tokens WHERE grant_id=oauth_grants.id) AND NOT EXISTS(SELECT 1 FROM oauth_codes WHERE grant_id=oauth_grants.id)`).bind(now-DAY),
    env.DB.prepare(`DELETE FROM auth_rate_limits WHERE expires_at<?`).bind(now),
    env.DB.prepare(`DELETE FROM identity_signup_cooldowns WHERE expires_at<=?`).bind(now),
    env.DB.prepare(`DELETE FROM oauth_clients WHERE created_at<? AND id NOT IN (SELECT client_id FROM oauth_grants)`).bind(now - 30 * DAY),
  ]);
  const pending=await env.DB.prepare(`SELECT user_id,workspace_id FROM account_deletions ORDER BY created_at LIMIT 3`).all<{user_id:string;workspace_id:string}>();
  for(const row of pending.results) { try { await finishHumanDeletion(env,row.user_id,row.workspace_id); } catch { /* durable marker retries next run */ } }
  if(authProvider(env)==="clerk" && loginConfigured(env)) {
    const actions=await env.DB.prepare(`SELECT id FROM clerk_actions WHERE issuer=? AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 5`).bind(env.CLERK_ISSUER!,now).all<{id:string}>();
    for(const action of actions.results) await runClerkAction(env,action.id);
  }
}

async function pendingClerkAction(env: AuthEnv, action: "revoke_session"|"delete_user", subject: string, issuer: string) {
  const id=await sha256(JSON.stringify([action,issuer,subject])),now=Date.now();
  return {id,statement:env.DB.prepare(`INSERT OR IGNORE INTO clerk_actions(id,action,issuer,subject,created_at,next_attempt_at) VALUES (?,?,?,?,?,?)`).bind(id,action,issuer,subject,now,now)};
}
async function runClerkAction(env: AuthEnv, id: string): Promise<void> {
  const row=await env.DB.prepare(`SELECT * FROM clerk_actions WHERE id=?`).bind(id).first<{action:"revoke_session"|"delete_user";issuer:string;subject:string;attempts:number}>();
  if(!row || row.issuer!==env.CLERK_ISSUER) return;
  try { await clerkAction(env,row.action,row.subject); await env.DB.prepare(`DELETE FROM clerk_actions WHERE id=?`).bind(id).run(); }
  catch { await env.DB.prepare(`UPDATE clerk_actions SET attempts=attempts+1,next_attempt_at=? WHERE id=?`).bind(Date.now()+Math.min(HOUR,30_000*2**Math.min(row.attempts,7)),id).run(); }
}
async function revokeHumanAccess(env: AuthEnv, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO clerk_session_revocations(session_hash,created_at) SELECT token_hash,? FROM auth_sessions WHERE user_id=? AND provider='clerk'`).bind(Date.now(),userId),
    env.DB.prepare(`DELETE FROM oauth_requests WHERE session_hash IN (SELECT token_hash FROM auth_sessions WHERE user_id=?)`).bind(userId),
    env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id=?`).bind(userId),
    env.DB.prepare(`UPDATE oauth_grants SET revoked_at=? WHERE user_id=?`).bind(Date.now(),userId),
  ]);
}

/** Pause and mark deletion before removing data. A durable marker retries local
 * cleanup, while the provider outbox retries Clerk deletion independently.
 * Clerk identity tombstones stop valid old provider sessions recreating users;
 * hosted Google/dev identity hashes retain a 30-day reentry cooldown so account
 * deletion cannot immediately reset workspace quotas. No profile is retained. */
export async function deleteHumanAccount(env: AuthEnv, userId: string, workspaceId: string): Promise<void> {
  const owned = await env.DB.prepare(`SELECT identity_key,google_sub FROM users WHERE id=? AND workspace_id=?`).bind(userId,workspaceId).first<{identity_key:string|null;google_sub:string}>();
  if (!owned) fail(403,"access_denied","This workspace does not belong to this account.");
  let identityKey=owned.identity_key;
  if (identityKey===null) {
    // A pre-Clerk Worker can create users after the additive migration during
    // rollback. Recover only its persisted Google/dev subject, never email or
    // the current provider. A Clerk sentinel cannot recover its issuer/user ID.
    if (!owned.google_sub || owned.google_sub.startsWith("clerk:")) fail(503,"identity_unavailable","This account’s identity needs to be restored before deletion.");
    const dev=owned.google_sub.startsWith("dev:");
    identityKey=JSON.stringify([dev ? "dev" : "google",dev ? "local" : "https://accounts.google.com",owned.google_sub]);
  }
  const identity=JSON.parse(identityKey) as string[];
  const now=Date.now();
  const statements=[env.DB.prepare(`INSERT OR IGNORE INTO account_deletions(user_id,workspace_id,created_at) VALUES (?,?,?)`).bind(userId,workspaceId,now),env.DB.prepare(`UPDATE workspaces SET paused=1,identity_restricted=1 WHERE id=?`).bind(workspaceId)];
  const action=identity[0]==="clerk" ? await pendingClerkAction(env,"delete_user",identity[2],identity[1]) : undefined;
  if(action) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO identity_tombstones(identity_hash,created_at) VALUES (?,?)`).bind(await sha256(identityKey),now),action.statement);
  else if (isHosted(env)) statements.push(env.DB.prepare(`INSERT INTO identity_signup_cooldowns(identity_hash,expires_at) VALUES (?,?)
    ON CONFLICT(identity_hash) DO UPDATE SET expires_at=MAX(expires_at,excluded.expires_at)`).bind(await sha256(identityKey),now+30*DAY));
  await env.DB.batch(statements);
  await revokeHumanAccess(env,userId);
  if(action) await runClerkAction(env,action.id);
  await finishHumanDeletion(env,userId,workspaceId);
}
async function finishHumanDeletion(env: AuthEnv, userId: string, workspaceId: string): Promise<void> {
  await revokeHumanAccess(env,userId);
  await deleteWorkspaceContents({...env,WORKSPACE_ID:workspaceId});
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM oauth_requests WHERE session_hash IN (SELECT token_hash FROM auth_sessions WHERE user_id=?)`).bind(userId),
    env.DB.prepare(`DELETE FROM oauth_codes WHERE grant_id IN (SELECT id FROM oauth_grants WHERE user_id=? AND workspace_id=?)`).bind(userId,workspaceId),
    env.DB.prepare(`DELETE FROM oauth_tokens WHERE grant_id IN (SELECT id FROM oauth_grants WHERE user_id=? AND workspace_id=?)`).bind(userId,workspaceId),
    env.DB.prepare(`DELETE FROM oauth_grants WHERE user_id=? AND workspace_id=?`).bind(userId,workspaceId),
    env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id=?`).bind(userId),
    env.DB.prepare(`DELETE FROM pairing_codes WHERE workspace_id=?`).bind(workspaceId),
    env.DB.prepare(`DELETE FROM users WHERE id=? AND workspace_id=?`).bind(userId,workspaceId),
    env.DB.prepare(`DELETE FROM workspaces WHERE id=?`).bind(workspaceId),
    env.DB.prepare(`DELETE FROM account_deletions WHERE user_id=?`).bind(userId),
  ]);
}
