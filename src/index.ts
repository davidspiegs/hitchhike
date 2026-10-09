import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AuthError, workspaceAccountAllowed, authHtml, authProvider, authenticateOAuth, clerkUi, cleanupAuth, deleteHumanAccount, getHumanSession, handleAuth, isHosted, loginConfigured, mcpConnectionId, oauthChallenge, requireSessionCsrf, type AuthEnv } from "./auth";
import { backgroundSelectionForConfiguration } from "./setup-preferences";
import { issuePairing, redeemPairing } from "./pairing";
import { dashboardHtml, formPage, messagePage } from "./dashboard";
import { JOB_TYPES } from "./jobtypes";
import { handleMcp } from "./mcp";
import { scheduledMaintenance } from "./maintenance";
import { describeSubmit } from "./outcomes";
import { PLATFORMS, setupGuide } from "./platforms";
import { parseSubmission } from "./parse";
import { privacyHtml } from "./privacy";
import { termsHtml } from "./terms";
import { isPublicDocument } from "./public-pages";
import { noJobsText, renderJobForWorker } from "./render";
import {
  acknowledgeInbox,
  actorId,
  agentSetup,
  canSee,
  checkInbox,
  claimByToken,
  getOpenClaim,
  workspaceId,
  getWorkspace,
  getWorkspaceUsage,
  exportWorkspace,
  deleteWorkspaceContents,
  claimNext,
  createJob,
  deleteAgent,
  deleteSchedule,
  getJobRow,
  heartbeat,
  jobView,
  listAgents,
  listEvents,
  listJobs,
  listSchedules,
  maintenance,
  RelayError,
  ringDoorbells,
  submitResult,
  sweep,
  transition,
  upsertAgent,
  upsertSchedule,
  type Actor,
  type AgentRow,
  type Env,
  type Transition,
} from "./store";
import { PROTOCOL_VERSION } from "./types";
import { parseJSON, randomToken, safeEqual, sha256 } from "./util";
import { deploymentOrigins, OriginConfigurationError } from "./origins";
import { configurationIssue } from "./configuration";
import { recordPresence } from "./presence";
import { workspaceHtml } from "./workspace-ui";
import { getWorkspaceRelease, setWorkspaceRelease, getCollaborationConfiguration, updateCollaborationConfiguration, updateOnboardingProgress } from "./collaboration";
import { sendMessage, listConversations, readConversation, updateConversationContext, previewRequests, claimRequest, checkConversationInbox, acknowledgeConversation, stopConversation, extendConversation } from "./conversations";
import { ingressAdmission } from "./ingress";
import { assertResourceOperation, assertOwnerResourceOperation, resourceOperationForHttp, isOwnerResourceControlRoute, resourceBudgetStatus, ResourceBudgetError } from "./budgets";
import { mutationJob, mutationConversation } from "./mutation-response";
import { dispatchActivations, getActivation, saveActivation, revokeActivation, getActivationEvidence } from "./activation";

type AppEnv = { Bindings: AuthEnv & { RATE_LIMITER?: RateLimit; SERVICE_PAUSED?: string }; Variables: { publicDocument?: boolean; actor: Actor; relayEnv: Env; scopes: readonly string[] | undefined } };
type C = Context<AppEnv>;

const app = new Hono<AppEnv>();

const relayUrl = (c: C) => isHosted(c.env) ? deploymentOrigins(c.env,new URL(c.req.url).origin).apiOrigin : new URL(c.req.url).origin;
const wantsJson = (c: C) => c.req.query("format") === "json" || (c.req.header("accept") ?? "").includes("application/json");
const markdown = (c: C, status: number, body: string) =>
  c.body(body, status as 200, { "content-type": "text/markdown; charset=utf-8" });

const relayEnv = (c: C): Env => c.get("relayEnv") ?? c.env;
const roleScopes = (a: AgentRow) => ["relay:read", ...(a.can_request ? ["relay:send"] : []), ...(a.can_work ? ["relay:work"] : [])];

async function authenticate(c: C): Promise<Actor> {
  c.set("relayEnv", { ...c.env, WORKSPACE_ID: "default" });
  c.set("scopes", undefined);
  const bearer = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!isHosted(c.env) && bearer && c.env.ADMIN_TOKEN && await safeEqual(bearer, c.env.ADMIN_TOKEN)) return { owner: true, agent: null };
  if (isHosted(c.env)) {
    const oauth = bearer ? await authenticateOAuth(c.req.raw, c.env) : null;
    if (oauth) {
      c.set("relayEnv", { ...c.env, WORKSPACE_ID: oauth.workspaceId });
      c.set("scopes", oauth.scopes);
      const presence = recordPresence(c.env, oauth.agent);
      if (presence) c.executionCtx.waitUntil(presence);
      return { owner: false, agent: oauth.agent };
    }
    // A connection-specific MCP endpoint requires its matching OAuth audience.
    // Never fall through to a browser session or a generic bearer credential.
    if (mcpConnectionId(c.req.path)) return { owner: false, agent: null };
    if (!bearer || (authProvider(c.env)==="clerk" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(bearer))) {
      const session = await getHumanSession(c.req.raw, c.env);
      if (session) {
        if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) await requireSessionCsrf(c.req.raw, session, undefined, c.env);
        c.set("relayEnv", { ...c.env, WORKSPACE_ID: session.workspaceId });
        return { owner: true, agent: null };
      }
    }
  }
  const key = bearer ?? (!isHosted(c.env) ? c.req.query("key") : undefined);
  if (!key) return { owner: false, agent: null };
  // A unique credential determines its workspace; never a caller's workspace parameter.
  const agent = await c.env.DB.prepare(`SELECT * FROM agents WHERE token_hash=?`).bind(await sha256(key)).first<AgentRow>();
  if (!agent || (!isHosted(c.env) && agent.workspace_id !== "default") || !(await workspaceAccountAllowed(c.env, agent.workspace_id))) return { owner: false, agent: null };
  c.set("relayEnv", { ...c.env, WORKSPACE_ID: agent.workspace_id });
  c.set("scopes", roleScopes(agent));
  const presence = recordPresence(c.env, agent);
  if (presence) c.executionCtx.waitUntil(presence);
  return { owner: false, agent };
}

function requireScope(c: C, scope: string) {
  const actor = requireActor(c);
  if (!actor.owner && !c.get("scopes")?.includes(scope)) throw new RelayError(403, "insufficient_scope", `This connection needs ${scope} permission.`);
}

function ensureAdmission(c: C) {
  if (c.env.SERVICE_PAUSED === "true") throw new RelayError(503,"service_paused","New work is temporarily paused. Existing results remain available.");
}

function requireActor(c: C): Actor {
  const actor = c.get("actor");
  if (!actor.owner && !actor.agent) throw new RelayError(401, "unauthorized", "Missing or unknown token.");
  return actor;
}

function requireOwner(c: C) {
  requireActor(c);
  if (!c.get("actor").owner) throw new RelayError(403, "owner_only", "This needs the relay owner's token.");
}

/** A read-only owner preview; choosing an interval does not install a schedule. */
function setupBackgroundSelection(c: C, configuration: Parameters<typeof backgroundSelectionForConfiguration>[0]) {
  const enabled = c.req.queries("background_enabled"), interval = c.req.queries("background_interval");
  if (!enabled && !interval) return backgroundSelectionForConfiguration(configuration);
  if (enabled?.length !== 1 || !["true", "false"].includes(enabled[0]) || (interval && (interval.length !== 1 || !/^[0-9]{1,5}$/.test(interval[0])))) {
    throw new RelayError(400, "invalid_setup", "Choose whether to include background checks and a supported interval.");
  }
  const minutes = interval ? Number(interval[0]) : null;
  if (minutes !== null && (!Number.isSafeInteger(minutes) || minutes < 5 || minutes > 10080)) throw new RelayError(400, "invalid_setup", "Use an interval between 5 minutes and 7 days.");
  return { enabled: enabled[0] === "true", intervalMinutes: enabled[0] === "true" ? minutes : null };
}

async function hostedSetup(c: C, id: string, existing?: Awaited<ReturnType<typeof upsertAgent>>, issueCode = false) {
  const env = relayEnv(c);
  const a = await env.DB.prepare("SELECT * FROM agents WHERE id=? AND workspace_id=?").bind(id,workspaceId(env)).first<AgentRow>();
  if (!a) throw new RelayError(404,"not_found","No such connection.");
  const platform = PLATFORMS.find(p=>p.id===a.platform);
  const pairing = platform?.connects === "routine" && issueCode ? await issuePairing(env,a.id,relayUrl(c)) : null;
  const release = await getWorkspaceRelease(env);
  const configuration = release.enabled ? await getCollaborationConfiguration(env,c.get("actor"),id) : null;
  const surface = c.req.query("surface") ?? configuration?.onboarding.surface;
  const guide = setupGuide({agentId:a.id,name:a.name,token:"",relayUrl:relayUrl(c),canWork:!!a.can_work,canRequest:!!a.can_request,
    workTypes:parseJSON<string[]>(a.work_types,[]),pollMinutes:a.poll_minutes,platform:a.platform,hosted:true,pairingCode:pairing?.code,surface,conversationTools:release.enabled,instructionProfile:configuration?.settings.instructions.profile,background:setupBackgroundSelection(c,configuration)});
  const {token:_token,setup:_setup,...safe} = existing ?? {};
  return {...safe,guide,...(pairing ? {pairing:{expires_at:pairing.expires_at}} : {})};
}

async function requireBeta(c: C) {
  requireActor(c);
  if (!(await getWorkspaceRelease(relayEnv(c))).enabled) throw new RelayError(409,"beta_disabled","This workspace has not enabled the next-release beta.");
}
function dispatchBackground(c: C) {
  c.executionCtx.waitUntil(dispatchActivations(relayEnv(c),relayUrl(c)).catch(() => { console.error("Background dispatch deferred; inspect request activity."); }));
}
async function objectBody(c: C): Promise<Record<string,unknown>> {
  const value=await jsonBody(c);
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new RelayError(400,"invalid_json","Send a JSON object.");
  return value as Record<string,unknown>;
}
function queryInteger(c: C,key: string,min=0,max=Number.MAX_SAFE_INTEGER) {
  const value=c.req.query(key);
  if(value===undefined)return undefined;
  const n=Number(value);
  if(!value || !Number.isSafeInteger(n) || n<min || n>max)throw new RelayError(400,"invalid_query",`${key} must be an integer between ${min} and ${max}.`);
  return n;
}

async function jsonBody(c: C): Promise<unknown> {
  const raw = await c.req.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new RelayError(400, "invalid_json", "The body isn't valid JSON.");
  }
}

// Wrap every response, including host/origin rejection and body-limit errors.
app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Referrer-Policy")) c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", c.get("publicDocument") === true && c.res.status === 200 ? "index, follow" : "noindex");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  if (new URL(c.req.url).protocol === "https:") c.header("Strict-Transport-Security", "max-age=31536000");
  if (c.res.status >= 400 || c.req.path === "/" || c.req.path === "/privacy" || c.req.path === "/terms" || c.req.path.startsWith("/v1/") || c.req.path.startsWith("/w/") || c.req.path.startsWith("/mcp")) c.header("Cache-Control", "no-store");
});

// CORS precedes every early response, including authentication and body limits.
// It grants browser access only to the configured UI; API calls use bearer
// tokens with credentials omitted, so cookies are never enabled here.
app.use("*", async (c,next) => {
  if (!isHosted(c.env)) return next();
  const requestOrigin=new URL(c.req.url).origin;
  const {apiOrigin,frontendOrigin,split}=deploymentOrigins(c.env,requestOrigin);
  if (requestOrigin!==apiOrigin) return c.json({error:{code:"invalid_host",message:"Use the configured relay address."}},400);
  if (!split) return next();
  if (authProvider(c.env)!=="clerk") return c.json({error:{code:"setup_required",message:"A separate browser frontend requires Clerk authentication."}},503);
  c.header("Cache-Control","no-store");
  c.header("Vary","Origin");
  const browserOrigin=c.req.header("Origin");
  if (browserOrigin && browserOrigin!==frontendOrigin) return c.json({error:{code:"invalid_origin",message:"Use the configured browser frontend."}},403);
  if (browserOrigin===frontendOrigin) {
    c.header("Access-Control-Allow-Origin",frontendOrigin);
    c.header("Access-Control-Expose-Headers","Retry-After");
  }
  if(c.req.method==="OPTIONS" && c.req.header("Access-Control-Request-Method")) {
    const methods=["GET","HEAD","POST","PUT","PATCH","DELETE"];
    const allowedHeaders=["authorization","content-type","x-csrf-token","idempotency-key"];
    const requestedHeaders=(c.req.header("Access-Control-Request-Headers") ?? "").split(",").map(value=>value.trim().toLowerCase()).filter(Boolean);
    c.header("Vary","Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
    if(browserOrigin!==frontendOrigin || !methods.includes(c.req.header("Access-Control-Request-Method")!) || requestedHeaders.some(value=>!allowedHeaders.includes(value))) return c.json({error:{code:"invalid_preflight",message:"This browser request is not allowed."}},403);
    c.header("Access-Control-Allow-Methods",methods.join(", "));
    c.header("Access-Control-Allow-Headers",allowedHeaders.join(", "));
    c.header("Access-Control-Max-Age","600");
    return c.body(null,204);
  }
  await next();
  // Auth handlers return their own Response; decorate that final response too.
  const vary=new Set((c.res.headers.get("Vary") ?? "").split(",").map(value=>value.trim()).filter(Boolean));
  vary.add("Origin");
  c.header("Vary",[...vary].join(", "));
  c.header("Cache-Control","no-store");
  if(browserOrigin===frontendOrigin) {
    c.header("Access-Control-Allow-Origin",frontendOrigin);
    c.header("Access-Control-Expose-Headers","Retry-After");
  }
});

app.use("*", bodyLimit({ maxSize: 512 * 1024, onError: c => c.json({error:{code:"too_large",message:"The request exceeds 512 KB. Use a link for larger content."}},413) }));

app.use("*", async (c, next) => {
  const path = c.req.path;
  if (path === "/" || path.startsWith("/v1/") || path.startsWith("/auth/") ||
      path.startsWith("/oauth/") || path.startsWith("/mcp") || path.startsWith("/w/")) {
    const issue = configurationIssue(c.env, c.req.url);
    if (issue) {
      if (path === "/" && !wantsJson(c)) return c.html(messagePage("Setup required", issue), 503);
      return c.json({ error: { code: "setup_required", message: issue } }, 503);
    }
  }
  await next();
});

app.use("*", async (c,next) => {
  // Hono decodes unreserved path characters for routing. Reject alternative
  // spellings before admission/authentication so all layers see one path.
  if (c.req.path !== new URL(c.req.url).pathname) return c.json({error:{code:'noncanonical_path',message:'Use the endpoint path exactly as documented, without percent-encoding its characters.'}},400);
  const denied = await ingressAdmission(c.req.raw, c.env);
  if (denied) return denied;
  await next();
});

app.use("*", async (c,next) => {
  if (isHosted(c.env) && (c.req.query("key") || (c.req.path.startsWith("/mcp/") && !mcpConnectionId(c.req.path)))) return c.json({error:{code:"url_credentials_disabled",message:"Use your MCP endpoint with OAuth or an Authorization header."}},401);
  const response = await handleAuth(c.req.raw,c.env);
  if (response) return response;
  await next();
});

app.use("/v1/*", async (c, next) => {
  c.set("actor", await authenticate(c));
  const actor = c.get("actor");
  if ((actor.owner || actor.agent) && c.env.RATE_LIMITER) {
    const {success} = await c.env.RATE_LIMITER.limit({key:workspaceId(relayEnv(c))+":"+(actor.agent?.id || "owner")});
    if (!success) { c.header("Retry-After","60"); return c.json({error:{code:"rate_limited",message:"Too many requests. Try again in a minute."}},429); }
  }
  if (actor.owner || actor.agent) {
    const operation=resourceOperationForHttp(c.req.method,c.req.path);
    // Dashboard inspection must not exhaust agent work before using recovery.
    // Both owner counters remain bounded; agent credentials cannot enter them.
    if (actor.owner && !actor.agent && isOwnerResourceControlRoute(c.req.method,c.req.path)) {
      await assertOwnerResourceOperation(relayEnv(c),workspaceId(relayEnv(c)),actor,operation);
    } else await assertResourceOperation(relayEnv(c), workspaceId(relayEnv(c)), operation);
  }
  await next();
});

const isWorkerPath = (path: string) => path.startsWith("/v1/work") || path.startsWith("/v1/submit");

app.onError((err, c) => {
  if (err instanceof ResourceBudgetError) { c.header('Retry-After',String(err.retryAfterSeconds)); return c.json({error:{code:err.code,message:err.message}},err.status); }
  if (err instanceof Error && /(?:storage_limit|consumer_limit)/.test(err.message)) return c.json({error:{code:err.message.includes('consumer_limit')?'consumer_limit':'storage_limit',message:err.message.includes('consumer_limit')?'This connection has reached its delivery-consumer limit. Reuse an existing stable consumer ID.':'This workspace has reached its storage allowance. Remove unneeded content or wait for retention cleanup before adding more.'}},429);
  if (err instanceof OriginConfigurationError) return c.json({error:{code:"setup_required",message:err.message}},503);
  if (err instanceof AuthError) return c.json({error:{code:err.code,message:err.message}},err.status as 400);
  if (err instanceof RelayError) {
    if (isWorkerPath(c.req.path) && !wantsJson(c)) return markdown(c, err.status, `${err.code.toUpperCase()}. ${err.message}\n`);
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  console.error("Relay request failed", err instanceof Error ? err.name : "UnknownError");
  return c.json({ error: { code: "internal", message: "Something went wrong on the relay." } }, 500);
});

// ---------------------------------------------------------------- public

app.get("/", (c) => {
  if(isHosted(c.env)) {
    const {frontendOrigin,split}=deploymentOrigins(c.env,new URL(c.req.url).origin);
    if(split) return c.redirect(frontendOrigin+"/app",303);
  }
  const hosted=isHosted(c.env), provider=hosted ? authProvider(c.env) : "google", configured=hosted && loginConfigured(c.env);
  const publicLanding=isPublicDocument(c.req.raw,c.env);
  c.set("publicDocument",publicLanding);
  const clerk=provider==="clerk" && configured ? clerkUi(c.env,"/") : undefined;
  const page=dashboardHtml(c.env.RELAY_NAME || (hosted ? "Hitchhike" : "Agent relay"),{hosted,authConfigured:configured,authProvider:provider,clerk,nonce:clerk?.nonce,publicLanding});
  return clerk ? authHtml(page,200,undefined,clerk) : c.html(page);
});
/** Operator-stamped release (git SHA or tag); anything outside the identifier alphabet is withheld. */
const releaseIdentifier = (value: unknown): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9._-]{1,64}$/.test(trimmed) ? trimmed : null;
};
app.get("/healthz", (c) => c.json({ ok: true, protocol: PROTOCOL_VERSION, release: releaseIdentifier(c.env.HITCHHIKE_RELEASE), version: c.env.CF_VERSION_METADATA?.id ?? null }));
app.get("/beta", (c) => {
  const hosted=isHosted(c.env),provider=hosted?authProvider(c.env):"google",configured=hosted&&loginConfigured(c.env);
  if(hosted){const origins=deploymentOrigins(c.env,new URL(c.req.url).origin);if(origins.split)return c.redirect(origins.frontendOrigin+"/app-next",303);}
  const clerk=provider==="clerk"&&configured?clerkUi(c.env,"/beta"):undefined;
  const page=workspaceHtml(c.env.RELAY_NAME||"Hitchhike",{hosted,authConfigured:configured,authProvider:provider,clerk,nonce:clerk?.nonce});
  return clerk?authHtml(page,200,undefined,clerk):c.html(page);
});
// Terms and privacy describe the owner's hosted service only.
app.get("/terms", (c) => {
  if (!isHosted(c.env)) return c.notFound();
  return c.html(termsHtml());
});
app.get("/privacy", (c) => {
  if (!isHosted(c.env)) return c.notFound();
  const publicDocument=isPublicDocument(c.req.raw,c.env);
  c.set("publicDocument",publicDocument);
  return c.html(privacyHtml({indexable:publicDocument}));
});
app.post("/v1/pair", async (c) => {
  if (!isHosted(c.env)) return c.notFound();
  if (c.env.RATE_LIMITER && !(await c.env.RATE_LIMITER.limit({key:"pair:"+(c.req.header("cf-connecting-ip") || "local")})).success) return c.json({error:{code:"rate_limited",message:"Try again in a minute."}},429,{"Retry-After":"60"});
  const body = await jsonBody(c);
  if (!body || typeof body!=="object" || Array.isArray(body)) throw new RelayError(400,"invalid_json","Send a pairing code.");
  return c.json(await redeemPairing(c.env,(body as {code?:unknown}).code,relayUrl(c)));
});
app.get("/v1/types", (c) =>
  c.json({ types: Object.entries(JOB_TYPES).map(([id, t]) => ({ id, description: t.description, requires_approval: t.requires_approval, lease_seconds: t.lease_seconds })) }),
);
app.get("/v1/me", async (c) => {
  const actor = requireActor(c);
  if (actor.owner) return c.json({ id: "owner", owner: true });
  const a = actor.agent!;
  return c.json({ id: a.id, name: a.name, can_request: !!a.can_request && !!c.get("scopes")?.includes("relay:send"), can_work: !!a.can_work && !!c.get("scopes")?.includes("relay:work"), work_types: JSON.parse(a.work_types), capabilities: { targeted_claim: true, conversation_tools:(await getWorkspaceRelease(relayEnv(c))).enabled } });
});

// Additive beta API. Authentication, workspace binding, and provider scopes are
// the same as the legacy relay. Consumer IDs never grant additional access.
app.get("/v1/workspace/release",async(c)=>{requireOwner(c);return c.json(await getWorkspaceRelease(relayEnv(c)));});
app.put("/v1/workspace/release",async(c)=>{requireOwner(c);return c.json(await setWorkspaceRelease(relayEnv(c),c.get("actor"),await jsonBody(c)));});
app.get("/v1/configuration",async(c)=>{requireScope(c,"relay:read");await requireBeta(c);return c.json(await getCollaborationConfiguration(relayEnv(c),c.get("actor"),c.req.query("agent_id")));});
app.get("/v1/agents/:id/collaboration",async(c)=>{requireScope(c,"relay:read");await requireBeta(c);return c.json(await getCollaborationConfiguration(relayEnv(c),c.get("actor"),c.req.param("id")));});
app.put("/v1/agents/:id/collaboration",async(c)=>{requireOwner(c);await requireBeta(c);return c.json(await updateCollaborationConfiguration(relayEnv(c),c.get("actor"),c.req.param("id"),await jsonBody(c)));});
app.patch("/v1/agents/:id/onboarding",async(c)=>{requireOwner(c);await requireBeta(c);return c.json(await updateOnboardingProgress(relayEnv(c),c.get("actor"),c.req.param("id"),await jsonBody(c)));});
app.get("/v1/agents/:id/activation",async(c)=>{requireOwner(c);await requireBeta(c);return c.json({activation:await getActivation(relayEnv(c),c.req.param("id"))});});
app.put("/v1/agents/:id/activation",async(c)=>{
  requireOwner(c);await requireBeta(c);const body=await objectBody(c);
  if(Object.keys(body).some(k=>!["endpoint","token","enabled"].includes(k)))throw new RelayError(400,"invalid_activation","Unknown activation setting.");
  return c.json({activation:await saveActivation(relayEnv(c),c.get("actor"),c.req.param("id"),body as unknown as Parameters<typeof saveActivation>[3])});
});
app.delete("/v1/agents/:id/activation",async(c)=>{requireOwner(c);await requireBeta(c);await revokeActivation(relayEnv(c),c.get("actor"),c.req.param("id"));return c.json({ok:true});});
app.get("/v1/conversations",async(c)=>{
  requireScope(c,"relay:read");await requireBeta(c);
  return c.json({conversations:await listConversations(relayEnv(c),c.get("actor"),{limit:queryInteger(c,"limit",1,100),before:queryInteger(c,"before")})});
});
async function sendConversation(c: C) {
  requireScope(c,"relay:send");await requireBeta(c);ensureAdmission(c);
  const body=await objectBody(c),id=c.req.param("id"),key=c.req.header("idempotency-key");
  if(id && body.conversation_id!==undefined && body.conversation_id!==id)throw new RelayError(400,"invalid_request","The conversation ID must match the URL.");
  if(key && body.idempotency_key!==undefined && body.idempotency_key!==key)throw new RelayError(400,"invalid_request","Use the same idempotency key in the body and header.");
  const out=await sendMessage(relayEnv(c),c.get("actor"),{...body,...(id?{conversation_id:id}:{}),...(key?{idempotency_key:key}:{})});
  if(out.request && !out.replay){const row=await getJobRow(relayEnv(c),out.request.id);if(row)c.executionCtx.waitUntil(ringDoorbells(relayEnv(c),[row],relayUrl(c)));dispatchBackground(c);}
  return c.json(mutationConversation(out,c.get("scopes"),c.get("actor").owner),out.replay?200:201);
}
app.post("/v1/conversations",sendConversation);
app.post("/v1/conversations/:id/messages",sendConversation);
app.get("/v1/conversations/inbox",async(c)=>{
  requireScope(c,"relay:read");await requireBeta(c);const agent=c.get("actor").agent;
  if(!agent)throw new RelayError(403,"agent_only","Use an agent connection to check its delivery inbox.");
  return c.json(await checkConversationInbox(relayEnv(c),agent,c.req.query("consumer_id")??"",{limit:queryInteger(c,"limit",1,100)}));
});
app.get("/v1/conversations/:id",async(c)=>{
  requireScope(c,"relay:read");await requireBeta(c);
  return c.json(await readConversation(relayEnv(c),c.get("actor"),c.req.param("id"),{after:queryInteger(c,"after"),limit:queryInteger(c,"limit",1,100)}));
});
app.patch("/v1/conversations/:id/context",async(c)=>{requireOwner(c);await requireBeta(c);return c.json(await updateConversationContext(relayEnv(c),c.get("actor"),c.req.param("id"),await jsonBody(c)));});
app.post("/v1/conversations/:id/acknowledge",async(c)=>{
  requireScope(c,"relay:read");await requireBeta(c);const agent=c.get("actor").agent,body=await objectBody(c);
  if(!agent)throw new RelayError(403,"agent_only","Use the receiving agent connection to acknowledge delivery.");
  if(Object.keys(body).some(k=>!["consumer_id","cursor"].includes(k)))throw new RelayError(400,"invalid_request","Send only consumer_id and cursor.");
  return c.json(await acknowledgeConversation(relayEnv(c),agent,c.req.param("id"),body.consumer_id as string,body.cursor as number));
});
app.post("/v1/conversations/:id/stop",async(c)=>{requireOwner(c);await requireBeta(c);return c.json(await stopConversation(relayEnv(c),c.get("actor"),c.req.param("id")));});
app.post("/v1/conversations/:id/extend",async(c)=>{requireOwner(c);await requireBeta(c);return c.json(await extendConversation(relayEnv(c),c.get("actor"),c.req.param("id"),await objectBody(c)));});
app.get("/v1/requests/pending",async(c)=>{
  requireScope(c,"relay:read");await requireBeta(c);const agent=c.get("actor").agent;
  if(!agent)throw new RelayError(403,"agent_only","Use an agent connection to preview its requests.");
  return c.json({requests:await previewRequests(relayEnv(c),agent,{limit:queryInteger(c,"limit",1,100)})});
});
app.post("/v1/requests/:id/claim",async(c)=>{
  requireScope(c,"relay:work");await requireBeta(c);const agent=c.get("actor").agent,body=await objectBody(c);
  if(!agent)throw new RelayError(403,"agent_only","Use the receiving agent connection to claim a request.");
  if(Object.keys(body).some(k=>k!=="consumer_id"))throw new RelayError(400,"invalid_request","Send only consumer_id.");
  const out=await claimRequest(relayEnv(c),agent,c.req.param("id"),body.consumer_id as string);
  if(!out.job)return c.json({request:null,reason:out.reason});
  return c.json({request:jobView(out.job,{omitDuplicatedCustomPrompt:true}),claim_id:out.token,resent:out.resent,configuration:out.job.collaboration_configuration});
});
app.post("/v1/requests/:id/reply",async(c)=>{
  requireScope(c,"relay:work");await requireBeta(c);const agent=c.get("actor").agent,body=await objectBody(c);
  if(Object.keys(body).some(k=>!["claim_id","message","status"].includes(k)) || typeof body.claim_id!=="string" || typeof body.message!=="string" || !body.message.trim() || body.message.length>20000 || (body.status!==undefined&&!['completed','needs_input','failed'].includes(body.status as string)))throw new RelayError(400,"invalid_request","Send claim_id, message (1–20,000 characters), and optional completed, needs_input or failed status.");
  const found=await claimByToken(relayEnv(c),body.claim_id);
  if(!agent || !found || found.claim.agent_id!==agent.id || found.job.id!==c.req.param("id"))throw new RelayError(404,"not_found","No claim for this request belonging to this connection.");
  const status=(body.status??"completed") as "completed"|"needs_input"|"failed";
  const parsed=parseSubmission("text/markdown",body.message);
  const submission=status==='completed'?{...parsed.submission,status}:{status,summary:body.message.slice(0,1200),body:body.message,...(status==='needs_input'?{question:body.message}:{error:body.message})};
  const out=await submitResult(relayEnv(c),body.claim_id,submission,parsed.notes,Date.now(),agent.id);
  const d=describeSubmit(out);return c.json({ok:d.status<300,outcome:d.code,message:d.message,errors:d.errors},d.status as 200);
});
app.get("/v1/requests/:id/activation",async(c)=>{requireOwner(c);await requireBeta(c);return c.json(await getActivationEvidence(relayEnv(c),c.req.param("id")));});

// ---------------------------------------------------------------- workers

app.on(["GET", "POST"], "/v1/work/next", async (c) => {
  requireScope(c,"relay:work");
  const { agent } = c.get("actor");
  if (!agent) throw new RelayError(401, "unauthorized", "Add your key as ?key=... or an Authorization: Bearer header.");
  if (!agent.can_work) throw new RelayError(403, "cannot_work", "This agent isn't set up to take jobs.");
  const jobId = c.req.query("job_id");
  if (jobId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) {
    throw new RelayError(400, "invalid_query", "Use one exact job ID for job_id.");
  }
  const now = Date.now();
  const requeued = await sweep(relayEnv(c), now);
  if (requeued.length) c.executionCtx.waitUntil(ringDoorbells(relayEnv(c), requeued, relayUrl(c)));

  const types = c.req.query("types")?.split(",").map((s) => s.trim()).filter(Boolean);
  const out = await claimNext(relayEnv(c), agent, now, types, jobId);
  if (!out.job) return wantsJson(c) ? c.json({ job: null, reason: out.reason }) : markdown(c, 200, noJobsText(out.reason));

  const job = jobView(out.job);
  const submitUrl = isHosted(c.env) ? `${relayUrl(c)}/v1/submit` : `${relayUrl(c)}/v1/submit/${out.token}`;
  const formUrl = `${relayUrl(c)}/w/${out.token}`;
  if (wantsJson(c)) {
    return c.json({ job, submit_url: submitUrl, ...(isHosted(c.env) ? {claim_id:out.token} : {form_url:formUrl}), resent: out.resent, rules: JOB_TYPES[job.type].rules });
  }
  return markdown(c, 200, renderJobForWorker(job, JOB_TYPES[job.type], isHosted(c.env) ? {kind:"authenticated-http",submitUrl,claimId:out.token} : {kind:"http",submitUrl,formUrl}));
});

async function submitHttp(c: C) {
  const token = isHosted(c.env) ? c.req.header("X-Claim-Token") : (c.req.header("X-Claim-Token") || c.req.param("token"));
  if (isHosted(c.env)) {
    requireScope(c,"relay:work");
    if (c.req.param("token")) throw new RelayError(400,"url_credentials_disabled","Send X-Claim-Token to POST /v1/submit instead.");
    const found = token ? await claimByToken(relayEnv(c),token) : null;
    if (!found || found.claim.agent_id !== c.get("actor").agent?.id) throw new RelayError(404,"not_found","No claim belonging to this connection.");
  }
  if (!token) throw new RelayError(400,"missing_claim","Send the claim identifier in X-Claim-Token.");
  const contentType = c.req.header("content-type") ?? "";
  const raw = await c.req.text();
  if (raw.length > 512 * 1024) {
    throw new RelayError(413, "too_large", "Your result is over 512 KB. Put the long part in a document or gist and include its link.");
  }
  const isForm = contentType.includes("application/x-www-form-urlencoded");
  const content = isForm ? (new URLSearchParams(raw).get("result") ?? "") : raw;
  if (!content.trim()) throw new RelayError(400, "empty", "Send your result as the request body.");

  const { submission, notes } = parseSubmission(isForm ? "text/markdown" : contentType, content);
  const out = await submitResult(relayEnv(c), token, submission, notes, Date.now(), isHosted(c.env) ? c.get("actor").agent?.id : undefined);
  const d = describeSubmit(out);
  if (isForm) return c.html(messagePage(d.code, d.message), d.status as 200);
  if (wantsJson(c)) return c.json({ ok: d.status < 300, outcome: d.code, message: d.message, errors: d.errors }, d.status as 200);
  return markdown(c, d.status, `${d.code}. ${d.message}\n`);
}
app.post("/v1/submit",submitHttp);
app.post("/v1/submit/:token",submitHttp);

app.post("/v1/submit/:token/heartbeat", async (c) => {
  if (isHosted(c.env)) throw new RelayError(400,"url_credentials_disabled","Use the authenticated heartbeat endpoint.");
  const until = await heartbeat(relayEnv(c), c.req.param("token"), Date.now());
  if (wantsJson(c)) return c.json({ ok: !!until, lease_expires_at: until ? new Date(until).toISOString() : null }, until ? 200 : 409);
  return until
    ? markdown(c, 200, `EXTENDED. The job is yours until ${new Date(until).toISOString().slice(11, 16)} UTC.\n`)
    : markdown(c, 409, "NOT_HELD. You don't hold this job anymore. Check for jobs again.\n");
});

app.post("/v1/heartbeat",async(c)=>{
  requireScope(c,"relay:work");
  const token=c.req.header("X-Claim-Token");
  const found=token ? await claimByToken(relayEnv(c),token) : null;
  if(!token || !found || found.claim.agent_id!==c.get("actor").agent?.id) throw new RelayError(404,"not_found","No claim belonging to this connection.");
  const until=await heartbeat(relayEnv(c),token,Date.now());
  return c.json({ok:!!until,lease_expires_at:until ? new Date(until).toISOString() : null},until ? 200 : 409);
});

// A browser-only agent can still take part: the claim link doubles as a form.
app.get("/w/:token", async (c) => {
  const token = c.req.param("token");
  if (isHosted(c.env)) return c.notFound();
  const found = await getOpenClaim(relayEnv(c),token);
  if (!found) return c.html(messagePage("UNKNOWN", "This link isn't valid. Check for jobs again to get a fresh one."), 404);
  const job = jobView(found.job);
  const open = ["claimed", "queued", "input_required"].includes(job.status) && found.claim.issued_at >= found.job.claims_valid_after;
  const brief = renderJobForWorker(job, JOB_TYPES[job.type], { kind: "http", submitUrl: `${relayUrl(c)}/v1/submit/${token}`, formUrl: `${relayUrl(c)}/w/${token}` });
  return c.html(formPage(job.title, brief, `/v1/submit/${token}`, open ? null : `This job is ${job.status}. No result is needed.`));
});

// ---------------------------------------------------------------- MCP

// The same job board as MCP tools. The key comes from the Authorization header, the path, or ?key=.
async function mcpRoute(c: C) {
  if (!isHosted(c.env)) return mcpConnectionId(c.req.path) ? c.notFound() : handleMcp(c.req.raw,c.env,relayUrl(c),p=>c.executionCtx.waitUntil(p),c.req.param("key"));
  const actor = await authenticate(c);
  c.set("actor",actor);
  if (!actor.agent) return new Response(JSON.stringify({error:"invalid_token"}),{status:401,headers:{"Content-Type":"application/json","WWW-Authenticate":oauthChallenge(c.req.raw,c.env)}});
  if (c.env.RATE_LIMITER && !(await c.env.RATE_LIMITER.limit({key:workspaceId(relayEnv(c))+":"+actor.agent.id})).success) return c.json({error:"rate_limited"},429,{"Retry-After":"60"});
  return handleMcp(c.req.raw,relayEnv(c),relayUrl(c),p=>c.executionCtx.waitUntil(p),undefined,{agent:actor.agent,scopes:c.get("scopes")});
}
app.all("/mcp",mcpRoute);
app.all("/mcp/connections/:connectionId",mcpRoute);
app.all("/mcp/:key",mcpRoute);

// ---------------------------------------------------------------- requesters

app.post("/v1/jobs", async (c) => {
  const actor = requireActor(c);
  requireScope(c,"relay:send");
  ensureAdmission(c);
  const now = Date.now();
  const { row, replay } = await createJob(relayEnv(c), actorId(actor), actor.agent, await jsonBody(c), c.req.header("idempotency-key"), now);
  if (!replay) { c.executionCtx.waitUntil(ringDoorbells(relayEnv(c), [row], relayUrl(c))); dispatchBackground(c); }
  return c.json({ job: mutationJob(row,c.get("scopes"),actor.owner), replay }, replay ? 200 : 201);
});

app.get("/v1/jobs", async (c) => {
  requireScope(c,"relay:read");
  const actor = requireActor(c);
  const since = c.req.query("since");
  const rows = await listJobs(relayEnv(c), actor, {
    role: c.req.query("role"),
    status: c.req.query("status")?.split(",").filter(Boolean),
    type: c.req.query("type"),
    since: since ? Date.parse(since) || Number(since) : undefined,
    limit: Number(c.req.query("limit")) || undefined,
  });
  return c.json({ jobs: rows.map((r) => jobView(r)) });
});

// HTTP and MCP use the same durable delivery cursor. Reading never acknowledges.
app.get("/v1/inbox", async (c) => {
  requireScope(c, "relay:read");
  const agent = requireActor(c).agent;
  if (!agent) throw new RelayError(403, "agent_required", "Read the inbox using a connection credential.");
  const integerQuery = (name: string, min: number, max: number): number | undefined => {
    const value = c.req.query(name);
    if (value === undefined) return undefined;
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
      throw new RelayError(400, "invalid_query", `Choose a valid ${name} between ${min} and ${max}.`);
    }
    return number;
  };
  const includeSeen = c.req.query("include_seen");
  if (includeSeen !== undefined && includeSeen !== "true" && includeSeen !== "false") {
    throw new RelayError(400, "invalid_query", "include_seen must be true or false.");
  }
  const env = relayEnv(c);
  if (!isHosted(c.env)) await sweep(env);
  const page = await checkInbox(env, agent, includeSeen === "true",
    integerQuery("cursor", 0, Number.MAX_SAFE_INTEGER), integerQuery("limit", 1, 100));
  return c.json({ ...page, arrived: page.arrived.map(row => jobView(row, { full: true })), pending: page.pending.map(row => jobView(row)) });
});

app.post("/v1/inbox/ack", async (c) => {
  requireScope(c, "relay:read");
  const agent = requireActor(c).agent;
  if (!agent) throw new RelayError(403, "agent_required", "Acknowledge the inbox using a connection credential.");
  const body = await jsonBody(c) as { delivery_cursor?: unknown };
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.delivery_cursor !== "number") {
    throw new RelayError(400, "invalid_cursor", "Send an object containing delivery_cursor from a complete inbox page.");
  }
  await acknowledgeInbox(relayEnv(c), agent, body.delivery_cursor);
  return c.json({ ok: true });
});

app.get("/v1/jobs/:id", async (c) => {
  requireScope(c,"relay:read");
  const actor = requireActor(c);
  const row = await getJobRow(relayEnv(c), c.req.param("id"));
  if (!row || !canSee(actor, row)) throw new RelayError(404, "not_found", "No such job.");
  return c.json({ job: jobView(row, { full: c.req.query("full") === "1" }) });
});

app.post("/v1/jobs/:id/:action{approve|cancel|reply|reject|accept}", async (c) => {
  requireScope(c,"relay:send");
  const actor = requireActor(c);
  const body = (await jsonBody(c)) as Record<string, unknown>;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RelayError(400,"invalid_json","Send a JSON object.");
  const text = [body.message, body.feedback, body.text].find((v) => typeof v === "string") as string | undefined;
  if (text && text.length>20000) throw new RelayError(413,"too_large","Feedback must be under 20,000 characters.");
  const row = await transition(relayEnv(c), actor, c.req.param("id"), c.req.param("action") as Transition, text, Date.now());
  if (row.status === "queued") { c.executionCtx.waitUntil(ringDoorbells(relayEnv(c), [row], relayUrl(c))); dispatchBackground(c); }
  return c.json({ job: mutationJob(row,c.get("scopes"),actor.owner) });
});

// ---------------------------------------------------------------- owner

app.get("/v1/events", async (c) => {
  requireOwner(c);
  return c.json({ events: await listEvents(relayEnv(c), Number(c.req.query("since")) || 0, Math.min(Number(c.req.query("limit")) || 100, 500)) });
});

app.get("/v1/admin/overview", async (c) => {
  requireOwner(c);
  const now = Date.now();
  const [agents, jobs, schedules, events, release] = await Promise.all([
    listAgents(relayEnv(c), now),
    listJobs(relayEnv(c), { owner: true, agent: null }, { limit: 100 }),
    listSchedules(relayEnv(c)),
    listEvents(relayEnv(c), Number(c.req.query("events_since")) || 0, 80),
    getWorkspaceRelease(relayEnv(c)),
  ]);
  return c.json({
    relay: { name: relayEnv(c).RELAY_NAME || (isHosted(c.env) ? "Hitchhike" : "Agent relay"), url: relayUrl(c), protocol: PROTOCOL_VERSION, now: new Date(now).toISOString() },
    job_types: Object.entries(JOB_TYPES).map(([id, t]) => ({ id, description: t.description, requires_approval: t.requires_approval })),
    platforms: PLATFORMS,
    agents,
    jobs: jobs.map((r) => jobView(r)),
    schedules,
    events,
    release,
  });
});

app.post("/v1/admin/agents", async (c) => {
  requireOwner(c);
  ensureAdmission(c);
  const out = await upsertAgent(relayEnv(c), await jsonBody(c), relayUrl(c), Date.now());
  return c.json(isHosted(c.env) ? await hostedSetup(c,out.agent.id,out,!!out.token) : out, out.created ? 201 : 200);
});
app.get("/v1/admin/agents/:id/setup", async (c) => {
  requireOwner(c);
  if (isHosted(c.env)) return c.json(await hostedSetup(c,c.req.param("id"),undefined,false));
  const conversationTools=(await getWorkspaceRelease(relayEnv(c))).enabled;
  const configuration=conversationTools?await getCollaborationConfiguration(relayEnv(c),c.get("actor"),c.req.param("id")):null;
  const surface=c.req.query("surface")??configuration?.onboarding.surface;
  return c.json(await agentSetup(relayEnv(c), c.req.param("id"), relayUrl(c),{surface,conversationTools,instructionProfile:configuration?.settings.instructions.profile,background:setupBackgroundSelection(c,configuration)}));
});
app.post("/v1/admin/agents/:id/setup",async(c)=>{
  requireOwner(c);
  if (isHosted(c.env)) return c.json(await hostedSetup(c,c.req.param("id")));
  const conversationTools=(await getWorkspaceRelease(relayEnv(c))).enabled;
  const configuration=conversationTools?await getCollaborationConfiguration(relayEnv(c),c.get("actor"),c.req.param("id")):null;
  const surface=c.req.query("surface")??configuration?.onboarding.surface;
  return c.json(await agentSetup(relayEnv(c),c.req.param("id"),relayUrl(c),{surface,conversationTools,instructionProfile:configuration?.settings.instructions.profile,background:setupBackgroundSelection(c,configuration)}));
});
app.post("/v1/admin/agents/:id/pairing",async(c)=>{
  requireOwner(c);
  if(!isHosted(c.env)) return c.notFound();
  return c.json(await issuePairing(relayEnv(c),c.req.param("id"),relayUrl(c)));
});
app.post("/v1/admin/agents/:id/test",async(c)=>{
  requireOwner(c);
  ensureAdmission(c);
  const env=relayEnv(c);
  const a=await env.DB.prepare("SELECT * FROM agents WHERE id=? AND workspace_id=?").bind(c.req.param("id"),workspaceId(env)).first<AgentRow>();
  if(!a || !a.can_work) throw new RelayError(400,"cannot_work","Enable Receive tasks on this connection to test it.");
  if(!parseJSON<string[]>(a.work_types,[]).includes("task")) throw new RelayError(400,"unsupported_test","Enable general tasks on this connection before running a test.");
  const marker=randomToken("Connected: ",12);
  const {row,replay}=await createJob(env,"owner",null,{
    type:"task",to:a.id,title:"Connection test for "+a.name,
    goal:`This is a connection test. Do not browse, access files, or use other services. Submit a completed result whose summary is exactly: ${marker}`,
    inputs:{connection_test:true,expected_response:marker},constraints:["Return only the requested marker; do not perform external actions."],
    expires_in_minutes:1440,
  },c.req.header("idempotency-key"),Date.now());
  if(!replay){c.executionCtx.waitUntil(ringDoorbells(env,[row],relayUrl(c)));dispatchBackground(c);}
  return c.json({job:jobView(row)},replay ? 200 : 201);
});
app.get("/v1/admin/agents", async (c) => {
  requireOwner(c);
  return c.json({ agents: await listAgents(relayEnv(c), Date.now()) });
});
app.delete("/v1/admin/agents/:id", async (c) => {
  requireOwner(c);
  if (!(await deleteAgent(relayEnv(c), c.req.param("id"), Date.now()))) throw new RelayError(404, "not_found", "No such agent.");
  return c.json({ ok: true });
});

app.post("/v1/admin/schedules", async (c) => {
  requireOwner(c);
  ensureAdmission(c);
  return c.json({ schedule: await upsertSchedule(relayEnv(c), await jsonBody(c), Date.now()) });
});
app.get("/v1/admin/schedules", async (c) => {
  requireOwner(c);
  return c.json({ schedules: await listSchedules(relayEnv(c)) });
});
app.delete("/v1/admin/schedules/:id", async (c) => {
  requireOwner(c);
  if (!(await deleteSchedule(relayEnv(c), c.req.param("id"), Date.now()))) throw new RelayError(404, "not_found", "No such schedule.");
  return c.json({ ok: true });
});

app.post("/v1/admin/tick", async (c) => {
  requireOwner(c);
  dispatchBackground(c);
  return c.json(await maintenance(relayEnv(c), relayUrl(c)));
});

app.get("/v1/admin/workspace",async(c)=>{
  requireOwner(c);
  const env=relayEnv(c), w=await getWorkspace(env);
  const resources=await resourceBudgetStatus(env,workspaceId(env));
  if(!w)throw new RelayError(404,"not_found","No such workspace.");
  return c.json({workspace:{id:w.id,name:w.name,paused:!!w.paused,retention_days:w.retention_days},resources:{enabled:resources.enabled,new_work_paused:resources.new_work_paused,...(resources.workspace?{workspace:resources.workspace}:{})},usage:await getWorkspaceUsage(env),
    limits:{connections:w.connection_limit,polling_workers:w.polling_worker_limit,jobs_day:w.daily_job_limit,jobs_month:w.monthly_job_limit,storage_bytes:w.storage_limit_bytes,open_jobs:w.max_open_jobs}});
});
app.patch("/v1/admin/workspace",async(c)=>{
  requireOwner(c);
  const body=await jsonBody(c);
  if(!body || typeof body!=="object" || Array.isArray(body))throw new RelayError(400,"invalid_json","Send workspace settings.");
  const b=body as Record<string,unknown>;
  if(Object.keys(b).some(k=>!["paused","retention_days","name"].includes(k)))throw new RelayError(400,"invalid_settings","Unknown workspace setting.");
  const w=await getWorkspace(relayEnv(c));
  if(!w)throw new RelayError(404,"not_found","No such workspace.");
  if(b.paused!==undefined && typeof b.paused!=="boolean")throw new RelayError(400,"invalid_settings","Pause must be true or false.");
  if(b.retention_days!==undefined && (typeof b.retention_days!=="number" || !Number.isInteger(b.retention_days) || b.retention_days<1 || b.retention_days>30))throw new RelayError(400,"invalid_settings","Choose between 1 and 30 days of history.");
  if(b.name!==undefined && (typeof b.name!=="string" || !b.name.trim() || b.name.length>80))throw new RelayError(400,"invalid_settings","Use a workspace name under 80 characters.");
  await c.env.DB.prepare("UPDATE workspaces SET name=?,paused=?,retention_days=? WHERE id=?")
    .bind(typeof b.name==="string"?b.name.trim():w.name,b.paused===undefined?w.paused:b.paused?1:0,b.retention_days??w.retention_days,w.id).run();
  return c.json({ok:true});
});
app.get("/v1/admin/export",async(c)=>{
  requireOwner(c);
  c.header("Content-Disposition",isHosted(c.env) ? 'attachment; filename="hitchhike-export.json"' : 'attachment; filename="relay-export.json"');
  return c.json(await exportWorkspace(relayEnv(c)));
});
app.delete("/v1/admin/workspace",async(c)=>{
  requireOwner(c);
  const body=await jsonBody(c) as {confirmation?:unknown};
  if(body?.confirmation!=="DELETE")throw new RelayError(400,"confirmation_required","Confirm deletion by typing DELETE.");
  const env=relayEnv(c), id=workspaceId(env);
  const session=isHosted(c.env)?await getHumanSession(c.req.raw,c.env):null;
  if(session){
    await deleteHumanAccount(c.env,session.userId,id);
  } else {
    await deleteWorkspaceContents(env);
    await env.DB.prepare("DELETE FROM pairing_codes WHERE workspace_id=?").bind(id).run();
    if (!isHosted(c.env) && id === "default") {
      await env.DB.prepare("UPDATE workspaces SET paused=0 WHERE id='default'").run();
    }
  }
  return c.json({ok:true});
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      const result = await scheduledMaintenance(env,env.PUBLIC_URL?.replace(/\/$/, "") ?? "");
      if (result.failed) console.error("Workspace maintenance failures", result.failed);
      await env.DB.prepare("DELETE FROM pairing_codes WHERE code_hash IN (SELECT code_hash FROM pairing_codes WHERE expires_at<? OR redeemed_at<? LIMIT 100)").bind(Date.now()-86400000,Date.now()-86400000).run();
      await cleanupAuth(env);
    })());
  },
} satisfies ExportedHandler<Env>;
