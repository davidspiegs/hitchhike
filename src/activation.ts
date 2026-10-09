/** Optional Claude Code wake adapter. A launch is not proof of execution or return pickup. */
import { openAgentKey, sealAgentKey } from "./crypto";
import { admitResourceOperation } from "./budgets";
import { assertCollaborationAllowed, collaborationClaimSQL, getWorkspaceRelease } from "./collaboration";
import { RelayError, workspaceId, type Actor, type AgentRow, type Env, type JobRow } from "./store";
import { iso, randomToken, ulid } from "./util";

const PROVIDER = "claude_code_routine";
const LIMIT = 8;
const MAX_ATTEMPTS = 3;
const RESERVATION_MS = 120_000;
const DAY = 86_400_000;
const ENDPOINT = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/(trig_[A-Za-z0-9_-]{4,128})\/fire$/;
const GENERATION_SQL = "CAST(j.attempts AS TEXT)||':'||CAST(j.claims_valid_after AS TEXT)";
const generation = (job: JobRow) => `${job.attempts}:${job.claims_valid_after}`;

type DispatchStatus = "pending" | "dispatching" | "launched" | "rate_limited" | "uncertain" | "failed" | "canceled";
interface ConfigRow {
  workspace_id: string; agent_id: string; provider: typeof PROVIDER; endpoint: string;
  token_ciphertext: string | null; enabled: number; revision: number; created_at: number; updated_at: number;
}
interface DispatchRow {
  id: string; workspace_id: string; job_id: string; agent_id: string; generation: string;
  config_revision: number; status: DispatchStatus; attempts: number; next_attempt_at: number;
  reserved_until: number | null; reservation_nonce: string | null; http_status: number | null; error_code: string | null;
  provider_session_id: string | null; provider_session_url: string | null; created_at: number; updated_at: number;
}
export interface ActivationInput { endpoint: string; token: string; enabled?: boolean }
export interface ActivationMetadata {
  provider: typeof PROVIDER; agent_id: string; configured: boolean; enabled: boolean;
  endpoint_host: "api.anthropic.com"; routine_hint: string; revision: number;
  created_at: string; updated_at: string; background_verified: false;
  latest_dispatch: ReturnType<typeof publicDispatch> | null;
}
const publicDispatch = (row: DispatchRow) => ({
  id: row.id, request_id: row.job_id, generation: row.generation, status: row.status,
  attempts: row.attempts, next_attempt_at: row.status === "rate_limited" ? iso(row.next_attempt_at) : null,
  error_code: row.error_code, http_status: row.http_status,
  provider_session_id: row.provider_session_id, provider_session_url: row.provider_session_url,
  created_at: iso(row.created_at), updated_at: iso(row.updated_at),
});
const secretIdentity = (env: Env, agentId: string, endpoint: string) => `activation:${workspaceId(env)}:${agentId}:${endpoint}`;
const encryptionSecret = (env: Env) => env.ENCRYPTION_KEY || (env.HOSTED !== "true" && workspaceId(env) === "default" ? env.ADMIN_TOKEN : undefined);
const configRow = (env: Env, agentId: string) => env.DB.prepare(
  "SELECT * FROM activation_configs WHERE workspace_id=? AND agent_id=?",
).bind(workspaceId(env), agentId).first<ConfigRow>();

/** Hosting operator opt-in is independent of every owner-editable setting. */
export const activationServiceEnabled = (env: Env) => env.HOSTED !== "true" || env.HOSTED_ACTIVATION_ENABLED === "true";
function launchLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Math.min(1_000_000, Number(value)) : 0;
}
/** Keep enough immutable admission history for audits without unbounded growth. */
export async function pruneActivationAttempts(env: Env, now = Date.now(), limit = 100) {
  const bounded = Math.max(1, Math.min(1000, Math.trunc(limit) || 100));
  return env.DB.prepare(`DELETE FROM activation_launch_attempts WHERE rowid IN (
    SELECT rowid FROM activation_launch_attempts WHERE admitted_at<? ORDER BY admitted_at LIMIT ?)`)
    .bind(now - 90 * DAY, bounded).run();
}

/** Exact canonical provider endpoint only; query strings, credentials and redirects are forbidden. */
export function validateActivationEndpoint(value: unknown): string | null {
  return typeof value === "string" && ENDPOINT.test(value)
    ? null : "Use the exact Claude routine API URL ending in /trig_…/fire from Claude's routine settings.";
}
function ownerOnly(actor: Actor) {
  if (!actor.owner) throw new RelayError(403, "owner_only", "Only the workspace owner can configure background execution.");
}
async function requireAgent(env: Env, agentId: string) {
  const row = await env.DB.prepare("SELECT id FROM agents WHERE workspace_id=? AND id=?")
    .bind(workspaceId(env), agentId).first();
  if (!row) throw new RelayError(404, "not_found", "No such connection in this workspace.");
}

/** Safe owner-facing representation. Never return ciphertext, bearer token or the full trigger URL. */
export async function getActivation(env: Env, agentId: string): Promise<ActivationMetadata | null> {
  await requireAgent(env, agentId);
  const row = await configRow(env, agentId);
  if (!row) return null;
  const latest = await env.DB.prepare("SELECT * FROM activation_dispatches WHERE workspace_id=? AND agent_id=? ORDER BY created_at DESC,id DESC LIMIT 1")
    .bind(workspaceId(env), agentId).first<DispatchRow>();
  const trigger = ENDPOINT.exec(row.endpoint)?.[1];
  return {
    provider: PROVIDER, agent_id: agentId, configured: !!row.token_ciphertext, enabled: !!row.enabled,
    endpoint_host: "api.anthropic.com", routine_hint: trigger ? `trig_…${trigger.slice(-4)}` : "Unavailable",
    revision: row.revision, created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)!,
    background_verified: false, latest_dispatch: latest ? publicDispatch(latest) : null,
  };
}

/** Save or rotate a locally stored routine-scoped token. Saving never fires the routine. */
export async function saveActivation(env: Env, actor: Actor, agentId: string, input: ActivationInput, now = Date.now()) {
  ownerOnly(actor);
  await requireAgent(env, agentId);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RelayError(400, "invalid_activation", "Send the routine URL and routine token.");
  const error = validateActivationEndpoint(input.endpoint);
  if (error) throw new RelayError(400, "invalid_activation_endpoint", error);
  if (typeof input.token !== "string" || !/^sk-ant-oat01-[A-Za-z0-9_-]{8,4096}$/.test(input.token)) {
    throw new RelayError(400, "invalid_activation_token", "Use the scoped routine token from Claude's API trigger settings.");
  }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new RelayError(400, "invalid_activation", "enabled must be true or false.");
  const secret = encryptionSecret(env);
  if (!secret) throw new RelayError(503, "activation_encryption_unavailable", "Background credentials cannot be stored until encryption is configured.");
  const sealed = await sealAgentKey(secret, secretIdentity(env, agentId, input.endpoint), input.token);
  await env.DB.prepare(`INSERT INTO activation_configs (workspace_id,agent_id,endpoint,token_ciphertext,enabled,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(workspace_id,agent_id) DO UPDATE SET
    endpoint=excluded.endpoint,token_ciphertext=excluded.token_ciphertext,enabled=excluded.enabled,
    revision=activation_configs.revision+1,updated_at=excluded.updated_at`)
    .bind(workspaceId(env), agentId, input.endpoint, sealed, input.enabled === true ? 1 : 0, now).run();
  // A pending rate-limited reservation cannot silently switch routines or tokens.
  await env.DB.prepare(`UPDATE activation_dispatches SET status='canceled',error_code='configuration_changed',updated_at=?3
    WHERE workspace_id=?1 AND agent_id=?2 AND status IN ('pending','rate_limited')`)
    .bind(workspaceId(env), agentId, now).run();
  return getActivation(env, agentId);
}

/** Forgets local credentials. The owner separately revokes the scoped token in Claude. */
export async function revokeActivation(env: Env, actor: Actor, agentId: string, now = Date.now()) {
  ownerOnly(actor);
  await requireAgent(env, agentId);
  await env.DB.batch([
    env.DB.prepare(`UPDATE activation_configs SET enabled=0,token_ciphertext=NULL,revision=revision+1,updated_at=?3 WHERE workspace_id=?1 AND agent_id=?2`)
      .bind(workspaceId(env), agentId, now),
    env.DB.prepare(`UPDATE activation_dispatches SET status='canceled',error_code='configuration_revoked',updated_at=?3
      WHERE workspace_id=?1 AND agent_id=?2 AND status IN ('pending','rate_limited')`).bind(workspaceId(env), agentId, now),
  ]);
  return getActivation(env, agentId);
}

// Directed requests only. No fanout or implicit role assignment. Recheck at
// dispatch so canceled work, expired requests and changed permissions stay stopped.
const ELIGIBLE = `FROM jobs j JOIN workspaces w ON w.id=j.workspace_id AND w.paused=0 AND w.security_suspended=0 AND w.identity_restricted=0
  JOIN agents a ON a.workspace_id=j.workspace_id AND a.id=j.to_agent AND a.can_work=1
  JOIN activation_configs c ON c.workspace_id=j.workspace_id AND c.agent_id=a.id AND c.enabled=1 AND c.token_ciphertext IS NOT NULL
  WHERE j.workspace_id=?1 AND j.status='queued' AND (j.expires_at IS NULL OR j.expires_at>?2)
    AND NOT EXISTS (SELECT 1 FROM conversation_chains chain WHERE chain.workspace_id=j.workspace_id AND chain.root_id=j.chain_root_id AND chain.stopped_at IS NOT NULL)
    AND EXISTS (SELECT 1 FROM json_each(a.work_types) WHERE value=j.type)
    AND (j.from_agent='owner' OR (
      EXISTS (SELECT 1 FROM json_each(a.accept_from) WHERE value IN ('*',j.from_agent))
      AND EXISTS (SELECT 1 FROM agents sender WHERE sender.workspace_id=j.workspace_id AND sender.id=j.from_agent AND sender.can_request=1
        AND EXISTS (SELECT 1 FROM json_each(sender.request_targets) WHERE value IN ('*',a.id)))))`;
const eligibleSQL = (env: Env & { NEXT_RELEASE_BETA?: string }) => ELIGIBLE +
  (env.HOSTED !== "true" && env.NEXT_RELEASE_BETA === "true" ? "" : " AND w.next_release_beta=1");

// A queued launch owns a slot until pickup, expiry/cancellation, or a new work
// generation. Pickup replaces that slot with the job's live claim. Daily work
// counts the union of jobs already claimed and admitted, never both for one job.
const RECEIVER_CAPACITY = `a.daily_work_limit>0
  AND (SELECT COUNT(*) FROM (
    SELECT held.id AS job_id FROM jobs held WHERE held.workspace_id=j.workspace_id AND held.lease_holder=a.id
      AND held.status='claimed' AND held.lease_expires_at>=?2
    UNION SELECT d.job_id FROM activation_dispatches d JOIN jobs launched ON launched.workspace_id=d.workspace_id AND launched.id=d.job_id
      WHERE d.workspace_id=j.workspace_id AND d.agent_id=a.id AND d.status IN ('dispatching','launched','uncertain')
        AND launched.status='queued' AND (launched.expires_at IS NULL OR launched.expires_at>?2)
        AND d.generation=CAST(launched.attempts AS TEXT)||':'||CAST(launched.claims_valid_after AS TEXT)
  ) occupied WHERE occupied.job_id<>j.id)<a.max_leases
  AND (SELECT COUNT(*) FROM (
    SELECT claim.job_id FROM claims claim WHERE claim.workspace_id=j.workspace_id AND claim.agent_id=a.id AND claim.issued_at>?2-${DAY}
    UNION SELECT admitted.job_id FROM activation_launch_attempts admitted
      WHERE admitted.workspace_id=j.workspace_id AND admitted.agent_id=a.id AND admitted.admitted_at>?2-${DAY}
  ) worked WHERE worked.job_id<>j.id)<a.daily_work_limit`;

/** Exposed for diagnostic checks; eligibility is permission and queue state, never proof of provider readiness. */
export async function activationEligibility(env: Env, requestId: string, now = Date.now()): Promise<boolean> {
  if (env.SERVICE_PAUSED === "true" || env.NEW_WORK_PAUSED === "true" || !activationServiceEnabled(env)) return false;
  if (!(await getWorkspaceRelease(env)).enabled) return false;
  const job = await env.DB.prepare(`SELECT j.* ${eligibleSQL(env)} AND j.id=?3 AND ${RECEIVER_CAPACITY}`).bind(workspaceId(env), now, requestId).first<JobRow>();
  return !!job && await collaborationPermits(env, job);
}
async function collaborationPermits(env: Env, job: JobRow): Promise<boolean> {
  const sender = job.from_agent === "owner" ? null : await env.DB.prepare("SELECT * FROM agents WHERE workspace_id=? AND id=?")
    .bind(workspaceId(env), job.from_agent).first<AgentRow>();
  try {
    await assertCollaborationAllowed(env, { owner: job.from_agent === "owner", agent: sender }, job.to_agent, job.type);
    return true;
  } catch (error) {
    if (error instanceof RelayError && [401, 403, 404].includes(error.status)) return false;
    throw error;
  }
}
function retryAt(header: string | null, now: number): number {
  const parsed = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - now : 300_000;
  return now + Math.min(3_600_000, Math.max(60_000, Number.isFinite(parsed) ? parsed : 300_000));
}
async function finish(env: Env, row: DispatchRow, status: DispatchStatus, now: number,
  options: { error?: string; http?: number; next?: number; sessionId?: string; sessionUrl?: string } = {}) {
  // The status predicate prevents late completion from overwriting crash recovery.
  await env.DB.prepare(`UPDATE activation_dispatches SET status=?4,error_code=?5,http_status=?6,next_attempt_at=?7,
    provider_session_id=?8,provider_session_url=?9,reserved_until=NULL,updated_at=?10
    WHERE workspace_id=?1 AND id=?2 AND attempts=?3 AND status='dispatching' AND reservation_nonce=?11`)
    .bind(workspaceId(env), row.id, row.attempts, status, options.error ?? null, options.http ?? null,
      options.next ?? now, options.sessionId ?? null, options.sessionUrl ?? null, now, row.reservation_nonce).run();
}
async function readSession(response: Response): Promise<{ id: string; url: string } | null> {
  // Only bounded, allowlisted correlation fields are retained. Never store error bodies.
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value?.type !== "routine_fire" || typeof value.claude_code_session_id !== "string" ||
        !/^session_[A-Za-z0-9_-]{4,160}$/.test(value.claude_code_session_id) ||
        value.claude_code_session_url !== `https://claude.ai/code/${value.claude_code_session_id}`) return null;
    return { id: value.claude_code_session_id, url: value.claude_code_session_url };
  } catch { return null; }
}

/** Bounded reconciliation, atomic reservation, and provider I/O. No retries after ambiguous network outcomes. */
export async function dispatchActivations(env: Env, relayUrl: string, now = Date.now(), fetcher: typeof fetch = fetch, options: { limit?: number } = {}) {
  const limit = Math.max(1, Math.min(LIMIT, Math.trunc(options.limit ?? LIMIT) || LIMIT));
  const totals = { reserved: 0, launched: 0, rate_limited: 0, uncertain: 0, failed: 0, canceled: 0 };
  if (env.SERVICE_PAUSED === "true" || env.NEW_WORK_PAUSED === "true" || !activationServiceEnabled(env) || !(await getWorkspaceRelease(env)).enabled) return totals;
  const globalLimit = env.HOSTED === "true" ? launchLimit(env.HOSTED_ACTIVATION_DAILY_LIMIT, 50) : 1_000_000;
  const workspaceLimit = env.HOSTED === "true" ? launchLimit(env.HOSTED_ACTIVATION_WORKSPACE_DAILY_LIMIT, 10) : 1_000_000;
  let relay: URL;
  try { relay = new URL(relayUrl); } catch { return totals; }
  if (relay.protocol !== "https:" || relay.username || relay.password) return totals;
  // The provider may already have launched if our process stopped during I/O.
  await env.DB.prepare(`UPDATE activation_dispatches SET status='uncertain',error_code='interrupted_launch',updated_at=?2
    WHERE workspace_id=?1 AND status='dispatching' AND reserved_until<=?2`).bind(workspaceId(env), now).run();
  const jobs = await env.DB.prepare(`SELECT j.* ${eligibleSQL(env)} AND ${RECEIVER_CAPACITY}
    AND NOT EXISTS (SELECT 1 FROM activation_dispatches d WHERE d.workspace_id=j.workspace_id AND d.job_id=j.id AND d.generation=(${GENERATION_SQL}))
    ORDER BY j.created_at,j.id LIMIT ${limit}`).bind(workspaceId(env), now).all<JobRow>();
  for (const job of jobs.results ?? []) {
    await env.DB.prepare(`INSERT OR IGNORE INTO activation_dispatches
      (id,workspace_id,job_id,agent_id,generation,config_revision,status,next_attempt_at,created_at,updated_at)
      SELECT ?3,j.workspace_id,j.id,j.to_agent,(${GENERATION_SQL}),c.revision,'pending',?2,?2,?2 ${eligibleSQL(env)} AND j.id=?4 AND ${RECEIVER_CAPACITY}`)
      .bind(workspaceId(env), now, "act_" + ulid(now), job.id).run();
  }
  // Capacity filtering precedes LIMIT: an occupied worker must not starve a
  // different eligible worker when hosted maintenance admits only one per pass.
  const due = await env.DB.prepare(`SELECT d.* FROM activation_dispatches d WHERE d.workspace_id=?1
    AND d.status IN ('pending','rate_limited') AND d.next_attempt_at<=?2
    AND NOT EXISTS (SELECT 1 FROM jobs j JOIN agents a ON a.workspace_id=j.workspace_id AND a.id=d.agent_id
      WHERE j.workspace_id=d.workspace_id AND j.id=d.job_id AND j.status='queued' AND (${GENERATION_SQL})=d.generation
        AND NOT (${RECEIVER_CAPACITY}))
    ORDER BY d.next_attempt_at,d.id LIMIT ${limit}`)
    .bind(workspaceId(env), now).all<DispatchRow>();
  for (const candidate of due.results ?? []) {
    // Do not repeatedly debit operations for a known exhausted launch cap.
    // The guarded reservation below still checks both caps atomically: another
    // dispatcher can consume the final slot after this read, without a refund.
    const launchBudget = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM activation_launch_attempts WHERE admitted_at>?2-${DAY})<?3
      AND (SELECT COUNT(*) FROM activation_launch_attempts WHERE workspace_id=?1 AND admitted_at>?2-${DAY})<?4 AS launch_available`)
      .bind(workspaceId(env), now, globalLimit, workspaceLimit).first<{ launch_available: number }>();
    if (!launchBudget?.launch_available) break;
    const settleUnreserved = async (status: "failed" | "canceled", error: string) => {
      const result = await env.DB.prepare(`UPDATE activation_dispatches SET status=?4,error_code=?5,updated_at=?3
        WHERE workspace_id=?1 AND id=?2 AND status IN ('pending','rate_limited') AND attempts=?6`)
        .bind(workspaceId(env), candidate.id, now, status, error, candidate.attempts).run();
      if (result.meta.changes) totals[status]++;
    };
    const job = await env.DB.prepare(`SELECT j.* ${eligibleSQL(env)} AND j.id=?3`).bind(workspaceId(env), now, candidate.job_id).first<JobRow>();
    const config = await configRow(env, candidate.agent_id);
    if (!job || generation(job) !== candidate.generation || !config?.enabled || config.revision !== candidate.config_revision ||
        validateActivationEndpoint(config.endpoint) || !await collaborationPermits(env, job)) {
      await settleUnreserved("canceled", "request_or_configuration_changed"); continue;
    }
    const secret = encryptionSecret(env);
    const token = secret ? await openAgentKey(secret, secretIdentity(env, candidate.agent_id, config.endpoint), config.token_ciphertext, env.ENCRYPTION_KEY_PREVIOUS) : null;
    if (!token) { await settleUnreserved("failed", "credential_unavailable"); continue; }
    // Shared operation admission is independent of the provider-launch debit.
    // A later lost reservation race still consumed this bounded attempted work.
    if (!(await admitResourceOperation(env, workspaceId(env), { cost: 10, newWork: true }, now)).allowed) break;
    // Capacity, current policy, generation ownership and both rolling provider
    // budgets are checked by the same write. Its trigger records every admitted
    // attempt, including rate-limited and ambiguous calls, before network I/O.
    let row: DispatchRow | null;
    try {
      row = await env.DB.prepare(`UPDATE activation_dispatches SET status='dispatching',attempts=attempts+1,
          reserved_until=?3,reservation_nonce=?5,updated_at=?2
        WHERE workspace_id=?1 AND id=?4 AND status IN ('pending','rate_limited') AND next_attempt_at<=?2 AND attempts<${MAX_ATTEMPTS}
          AND EXISTS (SELECT 1 ${eligibleSQL(env)} AND j.id=activation_dispatches.job_id AND c.revision=activation_dispatches.config_revision
            AND (${GENERATION_SQL})=activation_dispatches.generation AND ${collaborationClaimSQL("j", "a.id")} AND ${RECEIVER_CAPACITY})
          AND (SELECT COUNT(*) FROM activation_launch_attempts WHERE admitted_at>?2-${DAY})<?6
          AND (SELECT COUNT(*) FROM activation_launch_attempts WHERE workspace_id=?1 AND admitted_at>?2-${DAY})<?7
        RETURNING *`).bind(workspaceId(env), now, now + RESERVATION_MS, candidate.id, randomToken("an_"), globalLimit, workspaceLimit).first<DispatchRow>();
    } catch (error) {
      // Metadata storage admission can reject the ledger insert. Its trigger
      // rolls back the dispatch reservation too, so no provider request occurs.
      if (error instanceof Error && error.message.includes("storage_limit")) continue;
      throw error;
    }
    if (!row) continue;
    totals.reserved++;
    // Recheck immediately before I/O, including nonce ownership: another pass
    // can recover a timed-out reservation while decryption or D1 was waiting.
    const stillEligible = await env.DB.prepare(`SELECT j.id ${eligibleSQL(env)} AND j.id=?3 AND c.revision=?4 AND (${GENERATION_SQL})=?5
      AND ${collaborationClaimSQL("j", "a.id")} AND ${RECEIVER_CAPACITY}
      AND EXISTS (SELECT 1 FROM activation_dispatches owned WHERE owned.workspace_id=?1 AND owned.id=?6
        AND owned.status='dispatching' AND owned.attempts=?7 AND owned.reservation_nonce=?8)`)
      .bind(workspaceId(env), now, row.job_id, row.config_revision, row.generation, row.id, row.attempts, row.reservation_nonce).first();
    if (!stillEligible) { await finish(env, row, "canceled", now, { error: "request_or_configuration_changed" }); totals.canceled++; continue; }
    try {
      const response = await fetcher(config.endpoint, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01", "anthropic-beta": "experimental-cc-routine-2026-04-01", "Content-Type": "application/json" },
        body: JSON.stringify({ text: JSON.stringify({ hitchhike_request_id: row.job_id, dispatch_id: row.id,
          expected_generation: row.generation, relay_origin: relay.origin,
          note: "Use the configured Hitchhike connector to retrieve and claim this specific request. A notification is not authorization for additional work." }) }),
      });
      if (response.status === 200) {
        const session = await readSession(response);
        if (session) { await finish(env, row, "launched", now, { http: 200, sessionId: session.id, sessionUrl: session.url }); totals.launched++; }
        else { await finish(env, row, "uncertain", now, { http: 200, error: "launch_response_unrecognized" }); totals.uncertain++; }
      } else if (response.status === 429) {
        await response.body?.cancel();
        if (row.attempts >= MAX_ATTEMPTS) { await finish(env, row, "failed", now, { http: 429, error: "rate_limit_retry_exhausted" }); totals.failed++; }
        else { await finish(env, row, "rate_limited", now, { http: 429, error: "provider_rate_limited", next: retryAt(response.headers.get("Retry-After"), now) }); totals.rate_limited++; }
      } else {
        await response.body?.cancel();
        // 5xx, unexpected successes and timeouts cannot disprove a new session.
        const ambiguous = response.status >= 500 || (response.status >= 200 && response.status < 300) || response.status === 408;
        const status = ambiguous ? "uncertain" : "failed";
        const code = ambiguous ? "launch_outcome_uncertain" : [401, 403].includes(response.status) ? "provider_access_denied" : response.status === 404 ? "routine_not_found" : response.status === 400 ? "routine_unavailable" : "provider_request_rejected";
        await finish(env, row, status, now, { http: response.status, error: code }); totals[status]++;
      }
    } catch {
      await finish(env, row, "uncertain", now, { error: "launch_outcome_uncertain" }); totals.uncertain++;
    }
  }
  return totals;
}

/** Relay timestamps are evidence of stages, not proof that Dots resumed without a human. */
export async function getActivationEvidence(env: Env, requestId: string) {
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE workspace_id=? AND id=?").bind(workspaceId(env), requestId).first<JobRow>();
  if (!job) throw new RelayError(404, "not_found", "No such request in this workspace.");
  const stages = await env.DB.prepare(`SELECT MIN(CASE WHEN kind='claimed' THEN ts END) AS first_pickup,
    MAX(CASE WHEN kind='claimed' THEN ts END) AS latest_pickup,
    MAX(CASE WHEN kind='completed' THEN ts END) AS latest_answer FROM events WHERE workspace_id=? AND job_id=?`)
    .bind(workspaceId(env), requestId).first<{ first_pickup: number | null; latest_pickup: number | null; latest_answer: number | null }>();
  const dispatches = await env.DB.prepare("SELECT * FROM activation_dispatches WHERE workspace_id=? AND job_id=? ORDER BY created_at,id")
    .bind(workspaceId(env), requestId).all<DispatchRow>();
  const answered = stages?.latest_answer ?? (job.status === "completed" ? job.completed_at : null);
  return {
    request_id: job.id, origin_connection_id: job.from_agent, recipient_connection_id: job.to_agent,
    request_created_at: iso(job.created_at), first_picked_up_at: iso(stages?.first_pickup),
    picked_up_at: iso(stages?.latest_pickup), answered_at: iso(answered), origin_retrieved_at: iso(job.retrieved_at),
    relay_round_trip_observed: !!(stages?.latest_pickup && answered && job.retrieved_at && job.retrieved_at >= answered && answered >= stages.latest_pickup),
    unattended_verified: false, destination_session_verified: false,
    verification_note: "A shared connection does not identify Dots. Match provider transcripts to this request and verify scheduled origin retrieval without human prompting before claiming unattended support.",
    dispatches: (dispatches.results ?? []).map(publicDispatch),
  };
}
