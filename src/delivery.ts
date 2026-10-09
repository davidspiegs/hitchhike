/** Durable, workspace-scoped webhook wake-ups. The job queue remains authoritative. */
import { openAgentKey, sealAgentKey } from "./crypto";
import type { AgentRow, Env, JobRow } from "./store";
import { sha256 } from "./util";

const MAX_ATTEMPTS = 5;
const CLAIM_LIMIT = 8;
const LEASE_MS = 90_000;
const HEADER_PREFIX = "wh1:";
const scope = (env: Env) => env.WORKSPACE_ID ?? "default";
const hosted = (env: Env) => env.HOSTED === "true" || scope(env) !== "default";

/** Operator allowlists contain exact, vetted service hostnames, never tenant-controlled DNS or wildcards. */
export function validateWakeUrl(env: Env, value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096 || /[\s\x00-\x1f\x7f]/.test(value)) return "`wake_url` must be a public HTTPS URL.";
  let url: URL;
  try { url = new URL(value); } catch { return "`wake_url` must be a public HTTPS URL."; }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    return "`wake_url` must use HTTPS on port 443, without credentials or a fragment.";
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".") || /^[\d.]+$/.test(host) || host.includes(":") ||
      !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|arpa)$/.test(host)) {
    return "`wake_url` cannot target a local address, IP address, or private hostname.";
  }
  const allowlist = (env.WAKE_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if ((hosted(env) || allowlist.length > 0) && !allowlist.includes(host)) {
    return "Webhook wake-ups require this exact service hostname in the operator's WAKE_ALLOWED_HOSTS configuration.";
  }
  return null;
}

const headerIdentity = (env: Env, agentId: string, url: string) => `wake-headers:${scope(env)}:${agentId}:${url}`;

function parseHeaders(encoded: string): Record<string, string> {
  if (new TextEncoder().encode(encoded).byteLength > 8192) throw new Error("Webhook headers must fit within 8 KB.");
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { throw new Error("Webhook headers must be a JSON object of string values."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Webhook headers must be a JSON object of string values.");
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error("Webhook headers support at most 32 entries.");
  for (const [name, content] of entries) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || typeof content !== "string" || /[\r\n\x00]/.test(content) ||
        /^(?:host|content-length|connection|transfer-encoding|upgrade|proxy-.*|forwarded|x-forwarded-.*|cf-.*|x-relay-delivery-id)$/i.test(name)) {
      throw new Error("Webhook headers contain an invalid or reserved transport header.");
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

async function readWakeHeaders(env: Env, agentId: string, url: string, encoded: string | null): Promise<Record<string, string>> {
  if (!encoded) return {};
  if (encoded.startsWith(HEADER_PREFIX)) {
    const secret = env.ENCRYPTION_KEY ?? (!hosted(env) ? env.ADMIN_TOKEN : undefined);
    if (!secret) throw new Error("Webhook header encryption is unavailable.");
    const plain = await openAgentKey(secret, headerIdentity(env, agentId, url), encoded.slice(HEADER_PREFIX.length), env.ENCRYPTION_KEY_PREVIOUS);
    if (plain === null) throw new Error("Webhook headers could not be decrypted; save them again.");
    return parseHeaders(plain);
  }
  if (hosted(env)) throw new Error("Webhook headers need to be saved again before this hosted connection can send wake-ups.");
  return parseHeaders(encoded);
}

/** On save, migrate plaintext and bind secrets to workspace, connection and destination. */
export async function prepareWakeHeaders(
  env: Env, agentId: string, wakeUrl: string | null, encoded: string | null, previousWakeUrl: string | null = wakeUrl,
): Promise<string | null> {
  if (!wakeUrl || !encoded) return null;
  const headers = encoded.startsWith(HEADER_PREFIX)
    ? await readWakeHeaders(env, agentId, previousWakeUrl ?? wakeUrl, encoded)
    : parseHeaders(encoded);
  if (!Object.keys(headers).length) return null;
  const plain = JSON.stringify(headers);
  const secret = env.ENCRYPTION_KEY ?? (!hosted(env) ? env.ADMIN_TOKEN : undefined);
  if (!secret) {
    if (hosted(env)) throw new Error("Configure ENCRYPTION_KEY before storing webhook headers.");
    return plain;
  }
  return HEADER_PREFIX + await sealAgentKey(secret, headerIdentity(env, agentId, wakeUrl), plain);
}

interface DeliveryRow {
  workspace_id: string;
  job_id: string;
  agent_id: string;
  generation: number;
  status: "pending" | "leased" | "delivered" | "failed" | "canceled";
  attempts: number;
  lease_token: string | null;
}

// Identical eligibility for immediate enqueue and recovery. Replies, rejections
// and requeues change updated_at, giving each queued generation a fresh wake-up.
const TARGETS = `FROM jobs j
  JOIN workspaces w ON w.id=j.workspace_id AND w.paused=0
  JOIN agents a ON a.workspace_id=j.workspace_id AND a.can_work=1 AND a.wake_url IS NOT NULL
    AND ((j.to_agent='*' AND a.id<>j.from_agent) OR j.to_agent=a.id)
    AND EXISTS (SELECT 1 FROM json_each(a.work_types) WHERE value=j.type)
    AND (j.from_agent='owner' OR EXISTS (SELECT 1 FROM json_each(a.accept_from) WHERE value IN ('*',j.from_agent)))
  LEFT JOIN wake_deliveries d ON d.workspace_id=j.workspace_id AND d.job_id=j.id AND d.agent_id=a.id AND d.generation=j.updated_at
  WHERE j.workspace_id=?1 AND j.status='queued' AND (j.expires_at IS NULL OR j.expires_at>?2) AND d.job_id IS NULL`;

function enqueueStatement(env: Env, now: number, job?: JobRow) {
  const sql = `INSERT OR IGNORE INTO wake_deliveries (workspace_id,job_id,agent_id,generation,status,attempts,next_attempt_at,created_at,updated_at)
    SELECT j.workspace_id,j.id,a.id,j.updated_at,'pending',0,?2,?2,?2 ${TARGETS}
    ${job ? "AND j.id=?3 AND j.updated_at=?4" : ""} ORDER BY j.created_at ASC,j.id,a.id LIMIT 100`;
  return job ? env.DB.prepare(sql).bind(scope(env), now, job.id, job.updated_at) : env.DB.prepare(sql).bind(scope(env), now);
}

/** Idempotent enqueue; recovery in drain also covers a dropped waitUntil enqueue. */
export async function enqueueDoorbells(env: Env, jobs: JobRow[], _relayUrl: string, now = Date.now()): Promise<void> {
  // Hosted outbound delivery remains disabled pending operator approval.
  if (hosted(env) || env.SERVICE_PAUSED === "true") return;
  const candidates = jobs.filter((job) => job.workspace_id === scope(env) && job.status === "queued");
  for (let i = 0; i < candidates.length; i += 50) {
    await env.DB.batch(candidates.slice(i, i + 50).map((job) => enqueueStatement(env, now, job)));
  }
}

function canReceive(agent: AgentRow, job: JobRow): boolean {
  try {
    const workTypes: unknown = JSON.parse(agent.work_types);
    const sources: unknown = JSON.parse(agent.accept_from);
    return !!agent.can_work && !!agent.wake_url && Array.isArray(workTypes) && workTypes.includes(job.type) &&
      ((job.to_agent === "*" && job.from_agent !== agent.id) || job.to_agent === agent.id) &&
      (job.from_agent === "owner" || (Array.isArray(sources) && (sources.includes("*") || sources.includes(job.from_agent))));
  } catch { return false; }
}

/** No task contents or credentials by default. Owners may supply a static body template. */
function wakeBody(job: JobRow, agent: AgentRow, relayUrl: string) {
  const vars: Record<string, string> = { job_id: job.id, title: job.title, type: job.type, from: job.from_agent, relay: relayUrl };
  const template = agent.wake_body ?? JSON.stringify({ event: "job_available", job_id: "{{job_id}}", type: "{{type}}", title: "{{title}}", from: "{{from}}" });
  const isJson = /^[\[{]/.test(template.trim());
  return {
    contentType: isJson ? "application/json" : "text/plain",
    body: template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => isJson ? JSON.stringify(vars[key] ?? "").slice(1, -1) : (vars[key] ?? "")),
  };
}

async function finishDelivery(env: Env, delivery: DeliveryRow, status: DeliveryRow["status"], now: number, httpStatus: number, error: string | null, nextAttemptAt = now) {
  const key = [scope(env), delivery.job_id, delivery.agent_id, delivery.generation, delivery.lease_token];
  const match = `workspace_id=?1 AND job_id=?2 AND agent_id=?3 AND generation=?4 AND lease_token=?5 AND status='leased'`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO events (workspace_id,ts,job_id,actor,kind,detail)
      SELECT ?1,?6,?2,'relay','doorbell',?7 WHERE EXISTS (SELECT 1 FROM wake_deliveries WHERE ${match})
        AND EXISTS (SELECT 1 FROM jobs WHERE workspace_id=?1 AND id=?2)`)
      .bind(...key, now, JSON.stringify({ agent: delivery.agent_id, ok: status === "delivered", status: httpStatus, delivery_status: status, attempt: delivery.attempts, error })),
    env.DB.prepare(`UPDATE wake_deliveries SET status=?6,updated_at=?7,next_attempt_at=?8,last_status=?9,last_error=?10,lease_token=NULL,lease_expires_at=NULL WHERE ${match}`)
      .bind(...key, status, now, nextAttemptAt, httpStatus || null, error),
  ]);
}

async function deliver(env: Env, delivery: DeliveryRow, relayUrl: string, now: number, send: typeof fetch): Promise<void> {
  const [job, agent, workspace] = await Promise.all([
    env.DB.prepare(`SELECT * FROM jobs WHERE workspace_id=? AND id=?`).bind(scope(env), delivery.job_id).first<JobRow>(),
    env.DB.prepare(`SELECT * FROM agents WHERE workspace_id=? AND id=?`).bind(scope(env), delivery.agent_id).first<AgentRow>(),
    env.DB.prepare(`SELECT paused FROM workspaces WHERE id=?`).bind(scope(env)).first<{ paused: number }>(),
  ]);
  if (!workspace || workspace.paused || !job || !agent || job.status !== "queued" || job.updated_at !== delivery.generation ||
      (job.expires_at !== null && job.expires_at <= now) || !canReceive(agent, job)) {
    await finishDelivery(env, delivery, "canceled", now, 0, "no_longer_eligible");
    return;
  }
  if (validateWakeUrl(env, agent.wake_url)) {
    await finishDelivery(env, delivery, "failed", now, 0, "destination_not_allowed");
    return;
  }
  let headers: Record<string, string>;
  try { headers = await readWakeHeaders(env, agent.id, agent.wake_url!, agent.wake_headers); }
  catch {
    await finishDelivery(env, delivery, "failed", now, 0, "headers_unavailable");
    return;
  }
  const payload = wakeBody(job, agent, relayUrl);
  const deliveryId = await sha256(`${scope(env)}:${job.id}:${agent.id}:${delivery.generation}`);
  let httpStatus = 0;
  let retry = true;
  let error: string | null = "network_error";
  let retryDelay = Math.min(900_000, 60_000 * 2 ** (delivery.attempts - 1));
  try {
    const response = await send(agent.wake_url!, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": payload.contentType, ...headers, "x-relay-delivery-id": deliveryId },
      body: payload.body,
    });
    httpStatus = response.status;
    // Never read/log response contents or follow redirects carrying credentials.
    await response.body?.cancel().catch(() => {});
    if (response.ok) {
      await finishDelivery(env, delivery, "delivered", now, httpStatus, null);
      return;
    }
    retry = [408, 425, 429].includes(httpStatus) || httpStatus >= 500;
    error = httpStatus >= 300 && httpStatus < 400 ? "redirect_refused" : "http_error";
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const delay = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
      if (Number.isFinite(delay)) retryDelay = Math.min(900_000, Math.max(retryDelay, delay));
    }
  } catch { /* Never record URLs or exception text. Transport failures are retried. */ }
  const pending = retry && delivery.attempts < MAX_ATTEMPTS;
  await finishDelivery(env, delivery, pending ? "pending" : "failed", now, httpStatus, error, now + retryDelay);
}

/** Leased at-least-once delivery; recipients may deduplicate using X-Relay-Delivery-Id. */
export async function drainDoorbells(env: Env, relayUrl: string, now = Date.now(), send: typeof fetch = fetch): Promise<void> {
  // Hosted outbound delivery remains disabled pending operator approval.
  if (hosted(env) || env.SERVICE_PAUSED === "true") return;
  const workspace = await env.DB.prepare(`SELECT paused FROM workspaces WHERE id=?`).bind(scope(env)).first<{ paused: number }>();
  if (!workspace || workspace.paused) return;
  // A request can commit a job and die before its waitUntil callback. Reconcile
  // missing outbox entries from the durable queue before claiming a batch.
  await enqueueStatement(env, now).run();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM wake_deliveries WHERE workspace_id=?1 AND
      (NOT EXISTS (SELECT 1 FROM jobs WHERE workspace_id=?1 AND id=wake_deliveries.job_id)
       OR NOT EXISTS (SELECT 1 FROM agents WHERE workspace_id=?1 AND id=wake_deliveries.agent_id))`).bind(scope(env)),
    env.DB.prepare(`UPDATE wake_deliveries SET status='failed',last_error='retry_limit',updated_at=?2,lease_token=NULL,lease_expires_at=NULL
      WHERE workspace_id=?1 AND status='leased' AND lease_expires_at<=?2 AND attempts>=?3`).bind(scope(env), now, MAX_ATTEMPTS),
  ]);
  const lease = crypto.randomUUID();
  const deliveries = (await env.DB.prepare(`UPDATE wake_deliveries SET status='leased',attempts=attempts+1,lease_token=?4,lease_expires_at=?5,updated_at=?2
    WHERE rowid IN (SELECT rowid FROM wake_deliveries WHERE workspace_id=?1 AND attempts<?3 AND
      ((status='pending' AND next_attempt_at<=?2) OR (status='leased' AND lease_expires_at<=?2))
      ORDER BY next_attempt_at,created_at LIMIT ?6) RETURNING *`)
    .bind(scope(env), now, MAX_ATTEMPTS, lease, now + LEASE_MS, CLAIM_LIMIT).all<DeliveryRow>()).results ?? [];
  // Two parallel groups stay inside the usual background execution window.
  for (let i = 0; i < deliveries.length; i += 4) {
    await Promise.all(deliveries.slice(i, i + 4).map((delivery) => deliver(env, delivery, relayUrl, now, send)));
  }
}

export async function deleteWorkspaceDeliveries(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM wake_deliveries WHERE workspace_id=?`).bind(scope(env)).run();
}
