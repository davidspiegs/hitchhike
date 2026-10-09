import { createClerkClient } from "@clerk/backend";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { deploymentOrigins, type OriginEnv } from "./origins";

export interface ClerkEnv extends OriginEnv {
  PUBLIC_URL?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_ISSUER?: string;
  CLERK_JWT_KEY?: string;
  CLERK_WEBHOOK_SIGNING_SECRET?: string;
  CLERK_ALLOW_DEVELOPMENT?: string;
}
export class ClerkAuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const local = (host: string) => ["localhost","127.0.0.1","[::1]"].includes(host);
export function clerkConfiguration(env: ClerkEnv): {publishableKey:string;frontendApi:string} {
  const {CLERK_PUBLISHABLE_KEY:key,CLERK_SECRET_KEY:secret,CLERK_ISSUER:issuer,PUBLIC_URL:base} = env;
  const invalid = () => new ClerkAuthError(503,"setup_required","Configure Clerk sign-in for this deployment.");
  if (!key || !secret || !issuer || !base || !/^pk_(test|live)_/.test(key)) throw invalid();
  let url: URL, app: URL, decoded: string;
  try { url=new URL(issuer); app=new URL(deploymentOrigins(env).frontendOrigin); decoded=atob(key.replace(/^pk_(test|live)_/,"")); } catch { throw invalid(); }
  if (url.origin !== issuer || url.protocol !== "https:" || !/^[a-z0-9.-]+$/.test(url.hostname) || decoded !== url.hostname + "$" || url.username || url.password) throw invalid();
  if (key.startsWith("pk_test_") && (!local(app.hostname) || !local(new URL(base).hostname)) && env.CLERK_ALLOW_DEVELOPMENT !== "true") throw new ClerkAuthError(503,"setup_required","Development Clerk credentials require explicit preview configuration.");
  if ((key.startsWith("pk_test_") && !secret.startsWith("sk_test_")) || (key.startsWith("pk_live_") && !secret.startsWith("sk_live_"))) throw invalid();
  return {publishableKey:key,frontendApi:issuer};
}
function client(env: ClerkEnv) {
  const config=clerkConfiguration(env);
  return createClerkClient({publishableKey:config.publishableKey,secretKey:env.CLERK_SECRET_KEY!,jwtKey:env.CLERK_JWT_KEY,telemetry:{disabled:true}});
}
export async function clerkIdentity(request: Request, env: ClerkEnv): Promise<{issuer:string;subject:string;sessionId:string} | null> {
  const config=clerkConfiguration(env), {apiOrigin:base,frontendOrigin,split}=deploymentOrigins(env);
  if(new URL(request.url).origin!==base) return null;
  // A separate frontend sends an explicit Clerk session token. Its browser
  // cookies must never authenticate the API, even if shared by a parent domain.
  let token=request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token && request.headers.has("Authorization")) return null;
  if (!token) {
    if (split) return null;
    const cookies=(request.headers.get("Cookie") ?? "").split(";").map(s=>s.trim()).filter(s=>s.startsWith("__session="));
    if (cookies.length !== 1) return null;
    token=cookies[0].slice("__session=".length);
  }
  if (!token || token.length>8192) return null;
  const h=new Headers({Authorization:`Bearer ${token}`});
  const state=await client(env).authenticateRequest(new Request(base+"/auth/session",{headers:h}),{acceptsToken:"session_token",authorizedParties:[frontendOrigin],clockSkewInMs:0});
  if (!state.isAuthenticated || state.tokenType !== "session_token") return null;
  const auth=state.toAuth();
  if (!auth || !auth.userId || !auth.sessionId || auth.sessionClaims.iss !== config.frontendApi || auth.sessionClaims.azp !== frontendOrigin) return null;
  return {issuer:config.frontendApi,subject:auth.userId,sessionId:auth.sessionId};
}
export async function clerkVerifiedEmail(env: ClerkEnv, subject: string): Promise<string> {
  const user=await client(env).users.getUser(subject);
  const email=user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId);
  if (user.id !== subject || user.banned || user.locked || !email || email.verification?.status !== "verified" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.emailAddress)) throw new ClerkAuthError(403,"verified_email_required","Verify your primary email address before opening your workspace.");
  return email.emailAddress.trim().toLowerCase();
}
export async function clerkAction(env: ClerkEnv, action: "revoke_session"|"delete_user", subject: string): Promise<void> {
  try {
    if (action==="revoke_session") await client(env).sessions.revokeSession(subject);
    else await client(env).users.deleteUser(subject);
  } catch(error) {
    // Retrying an already deleted provider resource is successful.
    if ((error as {status?:number})?.status !== 404) throw error;
  }
}
export async function clerkWebhook(request: Request, env: ClerkEnv) {
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET) throw new ClerkAuthError(503,"setup_required","Clerk webhooks are not configured.");
  try { return await verifyWebhook(request,{signingSecret:env.CLERK_WEBHOOK_SIGNING_SECRET}); }
  catch { throw new ClerkAuthError(400,"invalid_webhook","Invalid webhook signature."); }
}
