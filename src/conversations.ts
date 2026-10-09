import { withStorageBoundary } from "./store";
/** Durable conversations sit above existing jobs: a request still has one lease,
 * one recipient, the existing quotas, and the existing result validation. */
import { collaborationClaimSQL } from './collaboration';
import { actorId, canSee, claimNext, createJob, getJobRow, getWorkspace, jobView, RelayError, workspaceId, type Actor, type AgentRow, type Env, type JobRow } from './store';
import { isPlainObject } from './parse';
import { clamp, iso, parseJSON, ulid } from './util';
import type { ConversationMessage, Result } from './types';

const DAY = 86_400_000;
const OPEN = "status NOT IN ('completed','failed','canceled','expired')";
interface ConversationRow {
  workspace_id: string; id: string; title: string; participants: string; chain_root_id: string;
  created_at: number; last_message_at: number; stopped_at: number | null; retention_days: number; pinned_context: string; context_version: number;
}
interface MessageRow {
  id: number; workspace_id: string; conversation_id: string; request_id: string | null;
  from_agent: string; to_agent: string; kind: ConversationMessage['kind']; text: string;
  result: string | null; context: string | null; source_key: string; created_at: number;
}
export interface SendMessageInput {
  to: string; message: string; type?: string; title?: string; conversation_id?: string;
  parent_request_id?: string; response_requested?: boolean; idempotency_key?: string; constraints?: string[];
}
function authenticated(env: Env, actor: Actor) {
  if (!actor.owner && (!actor.agent || actor.agent.workspace_id !== workspaceId(env)))
    throw new RelayError(403, 'wrong_workspace', 'Use a connection in this workspace.');
}
function consumer(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,120}$/.test(value))
    throw new RelayError(400, 'invalid_consumer', 'consumer_id must contain 1–120 letters, digits, periods, colons, underscores or hyphens. Reuse a stable delivery ID for each interactive client or recurring consumer; claim execution IDs are separate.');
  return value;
}
const messageView = (m: MessageRow): ConversationMessage => ({ id: m.id, conversation_id: m.conversation_id, request_id: m.request_id, from: m.from_agent, to: m.to_agent, kind: m.kind, text: m.text, result: parseJSON<Result | null>(m.result, null), context: parseJSON<ConversationMessage["context"]>(m.context, null), created_at: iso(m.created_at)! });
async function conversationRow(env: Env, actor: Actor, id: string): Promise<ConversationRow> {
  authenticated(env, actor);
  const row = await env.DB.prepare('SELECT * FROM conversations WHERE workspace_id=? AND id=?').bind(workspaceId(env), id).first<ConversationRow>();
  if (!row) throw new RelayError(404, 'not_found', 'No such conversation.');
  if (!actor.owner) {
    const who = actor.agent!.id;
    const participant = parseJSON<string[]>(row.participants, []).includes(who);
    // A legacy broadcast only becomes visible to the worker that actually held it.
    const worked = participant ? true : await env.DB.prepare(`SELECT id FROM jobs WHERE workspace_id=? AND conversation_id=? AND (lease_holder=? OR result_by=?) LIMIT 1`).bind(workspaceId(env), id, who, who).first();
    if (!worked) throw new RelayError(404, 'not_found', 'No such conversation.');
  }
  return row;
}
async function conversationView(env: Env, row: ConversationRow) {
  const [chain, counts] = await Promise.all([
    env.DB.prepare(`SELECT * FROM conversation_chains WHERE workspace_id=? AND root_id=?`).bind(workspaceId(env), row.chain_root_id).first<{ max_requests: number; requests_used: number; max_depth: number; stopped_at: number | null }>(),
    env.DB.prepare(`SELECT (SELECT COUNT(*) FROM jobs WHERE workspace_id=?1 AND chain_root_id=?2) requests_used,
      (SELECT COUNT(*) FROM jobs WHERE workspace_id=?1 AND conversation_id=?3 AND ${OPEN}) outstanding_requests,
      (SELECT COUNT(*) FROM conversation_messages WHERE workspace_id=?1 AND conversation_id=?3) message_count,
      (SELECT json_object('id',j.id,'status',j.status,'retrieved_at',j.retrieved_at,'error',j.error,'created_at',j.created_at,'completed_at',j.completed_at,'updated_at',j.updated_at)
        FROM jobs j WHERE j.workspace_id=?1 AND j.id=(SELECT m.request_id FROM conversation_messages m
          WHERE m.workspace_id=?1 AND m.conversation_id=?3 AND m.kind='request' ORDER BY m.id DESC LIMIT 1)) latest_request`).bind(workspaceId(env), row.chain_root_id, row.id).first<{ requests_used: number; outstanding_requests: number; message_count: number; latest_request: string | null }>(),
  ]);
  const latest = parseJSON<{ id: string; status: string; retrieved_at: number | null; error: string | null; created_at: number; completed_at: number | null; updated_at: number } | null>(counts?.latest_request, null);
  return { latest_request: latest ? { ...latest, retrieved_at: iso(latest.retrieved_at), created_at: iso(latest.created_at), completed_at: iso(latest.completed_at), updated_at: iso(latest.updated_at) } : null,
    id: row.id, title: row.title, pinned_context: row.pinned_context, context_version: row.context_version, participants: parseJSON<string[]>(row.participants, []), chain_root_id: row.chain_root_id,
    created_at: iso(row.created_at)!, last_message_at: iso(row.last_message_at)!, stopped_at: iso(row.stopped_at ?? chain?.stopped_at ?? null),
    retention_days: row.retention_days, expires_at: counts?.outstanding_requests ? null : iso(row.last_message_at + row.retention_days * DAY),
    requests_used: chain?.requests_used ?? counts?.requests_used ?? 0, request_limit: chain?.max_requests ?? 10, depth_limit: chain?.max_depth ?? 2,
    outstanding_requests: counts?.outstanding_requests ?? 0, message_count: counts?.message_count ?? 0,
    limit_reached: (chain?.requests_used ?? counts?.requests_used ?? 0) >= (chain?.max_requests ?? 10) };
}
export async function listConversations(env: Env, actor: Actor, options: { limit?: number; before?: number } = {}) {
  authenticated(env, actor);
  const rows = await env.DB.prepare(`SELECT c.* FROM conversations c WHERE workspace_id=?1 AND (?2 IS NULL OR last_message_at<?2)
    AND (?3=1 OR EXISTS (SELECT 1 FROM json_each(c.participants) WHERE value=?4)
      OR EXISTS (SELECT 1 FROM jobs j WHERE j.workspace_id=c.workspace_id AND j.conversation_id=c.id AND (j.lease_holder=?4 OR j.result_by=?4)))
    ORDER BY last_message_at DESC,id DESC LIMIT ?5`).bind(workspaceId(env), options.before ?? null, actor.owner ? 1 : 0, actor.agent?.id ?? '', clamp(Math.trunc(options.limit ?? 30), 1, 100)).all<ConversationRow>();
  return Promise.all((rows.results ?? []).map(row => conversationView(env, row)));
}
export async function readConversation(env: Env, actor: Actor, id: string, options: { after?: number; limit?: number } = {}) {
  const row = await conversationRow(env, actor, id);
  const after = options.after ?? 0;
  if (!Number.isSafeInteger(after) || after < 0) throw new RelayError(400, 'invalid_cursor', 'after must be a non-negative message cursor.');
  const limit = clamp(Math.trunc(options.limit ?? 20), 1, 100);
  const [messages, requests] = await Promise.all([
    env.DB.prepare(`SELECT * FROM conversation_messages WHERE workspace_id=? AND conversation_id=? AND id>? ORDER BY id LIMIT ?`).bind(workspaceId(env), id, after, limit + 1).all<MessageRow>(),
    env.DB.prepare(`SELECT j.id,j.type,j.title,j.from_agent,j.to_agent,j.status,j.created_at,j.updated_at,j.completed_at,j.retrieved_at,j.delegation_depth
      FROM jobs j JOIN conversation_messages m ON m.workspace_id=j.workspace_id AND m.source_key=j.id||':request'
      WHERE j.workspace_id=? AND j.conversation_id=? ORDER BY m.id DESC LIMIT 21`).bind(workspaceId(env), id).all<Pick<JobRow, "id" | "type" | "title" | "from_agent" | "to_agent" | "status" | "created_at" | "updated_at" | "completed_at" | "retrieved_at" | "delegation_depth">>(),
  ]);
  const rows = messages.results ?? [];
  const page: MessageRow[] = [];
  let pageBytes = 0;
  for (const message of rows.slice(0, limit)) {
    const bytes = new TextEncoder().encode(message.text + (message.result ?? '') + (message.context ?? '')).length;
    // A single complete result can exceed the page target; never truncate it.
    if (page.length && pageBytes + bytes > 64 * 1024) break;
    page.push(message); pageBytes += bytes;
  }
  return { conversation: await conversationView(env, row), messages: page.map(messageView), requests: (requests.results ?? []).slice(0, 20).map(j => ({ id: j.id, type: j.type, title: j.title, from: j.from_agent, to: j.to_agent, status: j.status, created_at: iso(j.created_at), updated_at: iso(j.updated_at), completed_at: iso(j.completed_at), retrieved_at: iso(j.retrieved_at), delegation_depth: j.delegation_depth, request_url: `/v1/jobs/${encodeURIComponent(j.id)}?full=1` })),
    requests_may_be_omitted: (requests.results?.length ?? 0) > 20, request_context_note: "Only the latest 20 request summaries are included. Fetch a message's request_id with get_job or its /v1/jobs/:id?full=1 URL for complete request constraints and inputs.",
    next_cursor: page.at(-1)?.id ?? after, has_more: rows.length > page.length };
}

/** Human-maintained shared context is versioned content, never a new job or
 * permission grant. Old text is preserved in the immutable context event. */
async function updateConversationContextInternal(env: Env, actor: Actor, id: string, input: unknown, now = Date.now()) {
  if (!actor.owner) throw new RelayError(403, 'owner_only', 'Only the workspace owner may change shared conversation context.');
  if (!isPlainObject(input) || Object.keys(input).some(key => !['pinned_context', 'expected_version'].includes(key))
    || typeof input.pinned_context !== 'string' || input.pinned_context.length > 20000)
    throw new RelayError(400, 'invalid_context', 'Shared context must be text up to 20,000 characters.');
  if (input.expected_version !== undefined && (!Number.isSafeInteger(input.expected_version) || Number(input.expected_version) < 0))
    throw new RelayError(400, 'invalid_context', 'expected_version must be a non-negative integer.');
  const row = await conversationRow(env, actor, id);
  if (input.expected_version !== undefined && input.expected_version !== row.context_version)
    throw new RelayError(409, 'context_changed', 'Shared context changed elsewhere. Refresh and compare before saving.');
  if (input.pinned_context === row.pinned_context) return { conversation: await conversationView(env, row), message: null };
  const workspace = await getWorkspace(env);
  if (!workspace || workspace.paused || workspace.security_suspended || workspace.identity_restricted || env.SERVICE_PAUSED === 'true') throw new RelayError(403, 'workspace_paused', 'This workspace is paused.');
  const context = JSON.stringify({ previous_version: row.context_version, version: row.context_version + 1, previous_text: row.pinned_context });
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  const delta = 2 * bytes(input.pinned_context) - bytes(row.pinned_context) + bytes(context);
  const key = `context:${id}:${row.context_version + 1}`;
  const [changed] = await env.DB.batch<ConversationRow>([
    env.DB.prepare(`UPDATE conversations SET pinned_context=?1,context_version=context_version+1
      WHERE workspace_id=?2 AND id=?3 AND context_version=?4
      AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=?2 AND w.paused=0 AND w.security_suspended=0 AND w.identity_restricted=0
        AND COALESCE((SELECT SUM(length(CAST(spec AS BLOB))+length(CAST(thread AS BLOB))+COALESCE(length(CAST(result AS BLOB)),0)) FROM jobs WHERE workspace_id=?2),0)
        +COALESCE((SELECT SUM(length(CAST(text AS BLOB))+COALESCE(length(CAST(result AS BLOB)),0)+COALESCE(length(CAST(context AS BLOB)),0)) FROM conversation_messages WHERE workspace_id=?2),0)
        +COALESCE((SELECT SUM(length(CAST(pinned_context AS BLOB))) FROM conversations WHERE workspace_id=?2),0)+?5<=w.storage_limit_bytes)
      RETURNING *`).bind(input.pinned_context, workspaceId(env), id, row.context_version, delta),
    env.DB.prepare(`INSERT INTO conversation_messages(workspace_id,conversation_id,request_id,from_agent,to_agent,kind,text,context,source_key,created_at)
      SELECT ?1,?2,NULL,'owner','*','context',?3,?4,?5,?6 WHERE changes()>0`).bind(workspaceId(env), id, input.pinned_context, context, key, now),
  ]);
  if (!changed.results?.length) {
    const current = await conversationRow(env, actor, id);
    if (current.context_version !== row.context_version) throw new RelayError(409, 'context_changed', 'Shared context changed elsewhere. Refresh and compare before saving.');
    throw new RelayError(429, 'storage_limit', 'This workspace cannot store additional context. Shorten it or remove expired content.');
  }
  const message = await env.DB.prepare(`SELECT * FROM conversation_messages WHERE workspace_id=? AND source_key=?`).bind(workspaceId(env), key).first<MessageRow>();
  return { conversation: await conversationView(env, await conversationRow(env, actor, id)), message: message ? messageView(message) : null };
}

async function sendMessageInternal(env: Env, actor: Actor, input: unknown, now = Date.now()) {
  authenticated(env, actor);
  if (!isPlainObject(input)) throw new RelayError(400, 'invalid_request', 'Send an object containing to and message.');
  const allowed = new Set(['to', 'message', 'type', 'title', 'conversation_id', 'parent_request_id', 'response_requested', 'idempotency_key', 'constraints']);
  if (Object.keys(input).some(k => !allowed.has(k))) throw new RelayError(400, 'invalid_request', 'Unknown message field. Sender attribution comes from your connection.');
  const body = { ...input, ...(typeof input.to === "string" ? { to: input.to.trim() } : {}) } as unknown as SendMessageInput;
  if (typeof body.to !== 'string' || !body.to.trim() || body.to === '*' || body.to === actorId(actor)) throw new RelayError(400, 'invalid_recipient', 'Choose one other agent as the recipient.');
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 20000) throw new RelayError(400, 'invalid_message', 'A message must contain 1–20,000 characters.');
  if (body.response_requested !== undefined && typeof body.response_requested !== 'boolean') throw new RelayError(400, 'invalid_request', 'response_requested must be true or false.');
  if (body.idempotency_key !== undefined && (typeof body.idempotency_key !== 'string' || !body.idempotency_key || body.idempotency_key.length > 200)) throw new RelayError(400, 'invalid_request', 'An idempotency key must contain 1–200 characters.');
  for (const field of ['conversation_id', 'parent_request_id', 'type', 'title'] as const) if (body[field] !== undefined && (typeof body[field] !== 'string' || !body[field]?.trim())) throw new RelayError(400, 'invalid_request', `${field} must be a non-empty string.`);
  const who = actorId(actor);
  const existing = body.conversation_id ? await conversationRow(env, actor, body.conversation_id) : null;
  if (existing) {
    const pair = parseJSON<string[]>(existing.participants, []);
    if (!pair.includes(who) || !pair.includes(body.to) || pair.includes('*')) throw new RelayError(403, 'wrong_participants', 'Continue this conversation with its existing participants. Start a separate exchange for a different recipient.');
  }
  const parent = body.parent_request_id ? await getJobRow(env, body.parent_request_id) : null;
  if (body.parent_request_id && (!parent || !canSee(actor, parent))) throw new RelayError(404, 'not_found', 'No such parent request.');
  if (existing && parent && existing.chain_root_id !== parent.chain_root_id) throw new RelayError(400, 'wrong_chain', 'The parent request belongs to another work chain.');

  if (body.response_requested !== false) {
    const baseline = existing ? await env.DB.prepare(`SELECT delegation_depth FROM jobs WHERE workspace_id=? AND conversation_id=? ORDER BY created_at,id LIMIT 1`).bind(workspaceId(env), existing.id).first<{ delegation_depth: number }>() : null;
    const result = await createJob(env, who, actor.agent, {
      to: body.to, type: body.type ?? 'task', title: body.title ?? body.message.trim().slice(0, 120), goal: body.message.trim(),
      ...(body.constraints !== undefined ? { constraints: body.constraints } : {}), ...(body.parent_request_id ? { parent_id: body.parent_request_id } : {}),
      ...(body.idempotency_key ? { idempotency_key: body.idempotency_key } : {}),
    }, undefined, now, { conversationId: existing?.id, chainRootId: existing?.chain_root_id ?? parent?.chain_root_id ?? undefined,
      depth: baseline?.delegation_depth ?? (parent ? parent.delegation_depth + 1 : 0) });
    // A reused key cannot silently attach an old request to a new recipient/thread.
    const original = parseJSON<{ goal?: string; constraints?: string[] }>(result.row.spec, {});
    const expectedConstraints = Array.isArray(body.constraints) ? body.constraints.map(value => typeof value === "string" ? value.trim().slice(0, 1000) : value).filter(Boolean) : body.constraints ?? [];
    if (result.row.to_agent !== body.to || result.row.type !== (body.type ?? 'task') || result.row.parent_id !== (body.parent_request_id ?? null)
      || original.goal !== body.message.trim() || JSON.stringify(original.constraints ?? []) !== JSON.stringify(expectedConstraints)
      || (existing && result.row.conversation_id !== existing.id)) throw new RelayError(409, 'idempotency_conflict', 'This idempotency key already identifies a different conversation or recipient.');
    const conv = await conversationRow(env, actor, result.row.conversation_id!);
    const message = await env.DB.prepare(`SELECT * FROM conversation_messages WHERE workspace_id=? AND source_key=?`).bind(workspaceId(env), `${result.row.id}:request`).first<MessageRow>();
    return { conversation: await conversationView(env, conv), message: message ? messageView(message) : null, request: jobView(result.row, { full: true }), replay: result.replay };
  }

  if (!existing) throw new RelayError(400, 'conversation_required', 'Informational replies need an existing conversation. Start an exchange with a response request first.');
  // Informational messages request no work: enforce communication ACLs, not
  // worker/category eligibility. A send-only assistant must still receive replies.
  const peers = await env.DB.prepare(`SELECT a.id,a.request_targets,a.accept_from,a.auth_generation,a.can_request,c.settings
    FROM agents a LEFT JOIN agent_collaboration c ON c.workspace_id=a.workspace_id AND c.agent_id=a.id
    WHERE a.workspace_id=? AND a.id IN (?,?)`).bind(workspaceId(env), who, body.to).all<Pick<AgentRow, 'id' | 'request_targets' | 'accept_from' | 'auth_generation' | 'can_request'> & { settings: string | null }>();
  const sender = (peers.results ?? []).find(p => p.id === who);
  const recipient = (peers.results ?? []).find(p => p.id === body.to);
  const allows = (raw: string, peer: string) => { const list = parseJSON<string[]>(raw, []); return list.includes('*') || list.includes(peer); };
  const permits = (settings: string | null, peer: string) => { const list = parseJSON<{ permitted_collaborators: string[] }>(settings, { permitted_collaborators: ['*'] }).permitted_collaborators; return list.includes('*') || list.includes(peer); };
  if ((!actor.owner && (!sender || !sender.can_request || sender.auth_generation !== actor.agent!.auth_generation || !allows(sender.request_targets, body.to) || !permits(sender.settings, body.to)))
    || (body.to !== 'owner' && (!recipient || (!actor.owner && (!allows(recipient.accept_from, who) || !permits(recipient.settings, who))))))
    throw new RelayError(403, 'collaborator_not_allowed', 'Current connection permissions do not allow this exchange.');
  const workspace = await getWorkspace(env);
  if (!workspace || workspace.paused || workspace.security_suspended || workspace.identity_restricted || env.SERVICE_PAUSED === 'true') throw new RelayError(403, 'workspace_paused', 'This workspace is paused.');
  const sourceKey = body.idempotency_key ? `note:${who}:${body.idempotency_key}` : `note:${ulid(now)}`;
  const prior = await env.DB.prepare(`SELECT * FROM conversation_messages WHERE workspace_id=? AND source_key=?`).bind(workspaceId(env), sourceKey).first<MessageRow>();
  if (prior && (prior.conversation_id !== existing.id || prior.to_agent !== body.to || prior.text !== body.message.trim())) throw new RelayError(409, 'idempotency_conflict', 'This key already identifies a different message.');
  const inserted = await env.DB.prepare(`INSERT INTO conversation_messages(workspace_id,conversation_id,request_id,from_agent,to_agent,kind,text,source_key,created_at)
    SELECT ?1,?2,?3,?4,?5,'note',?6,?7,?8 WHERE EXISTS (SELECT 1 FROM conversations c JOIN conversation_chains ch ON ch.workspace_id=c.workspace_id AND ch.root_id=c.chain_root_id WHERE c.workspace_id=?1 AND c.id=?2 AND c.stopped_at IS NULL AND ch.stopped_at IS NULL)
    AND (?4='owner' OR EXISTS (SELECT 1 FROM agents s WHERE s.workspace_id=?1 AND s.id=?4 AND s.auth_generation=?9 AND s.can_request=1
      AND EXISTS(SELECT 1 FROM json_each(s.request_targets) WHERE value='*' OR value=?5)))
    AND (?5='owner' OR EXISTS (SELECT 1 FROM agents t WHERE t.workspace_id=?1 AND t.id=?5
      AND (?4='owner' OR EXISTS(SELECT 1 FROM json_each(t.accept_from) WHERE value='*' OR value=?4))))
    AND NOT EXISTS(SELECT 1 FROM agent_collaboration p WHERE p.workspace_id=?1
      AND ((p.agent_id=?4 AND NOT EXISTS(SELECT 1 FROM json_each(p.settings,'$.permitted_collaborators') WHERE value='*' OR value=?5))
        OR (?4<>'owner' AND p.agent_id=?5 AND NOT EXISTS(SELECT 1 FROM json_each(p.settings,'$.permitted_collaborators') WHERE value='*' OR value=?4))))
    AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id=?1 AND w.paused=0 AND w.security_suspended=0 AND w.identity_restricted=0
      AND COALESCE((SELECT SUM(length(CAST(spec AS BLOB))+length(CAST(thread AS BLOB))+COALESCE(length(CAST(result AS BLOB)),0)) FROM jobs WHERE workspace_id=?1),0)
      +COALESCE((SELECT SUM(length(CAST(text AS BLOB))+COALESCE(length(CAST(result AS BLOB)),0)+COALESCE(length(CAST(context AS BLOB)),0)) FROM conversation_messages WHERE workspace_id=?1),0)
      +COALESCE((SELECT SUM(length(CAST(pinned_context AS BLOB))) FROM conversations WHERE workspace_id=?1),0)+length(CAST(?6 AS BLOB))<=w.storage_limit_bytes)
    ON CONFLICT(workspace_id,source_key) DO NOTHING`).bind(workspaceId(env), existing.id, parent?.id ?? null, who, body.to, body.message.trim(), sourceKey, now, actor.agent?.auth_generation ?? 0).run();
  const message = await env.DB.prepare(`SELECT * FROM conversation_messages WHERE workspace_id=? AND source_key=?`).bind(workspaceId(env), sourceKey).first<MessageRow>();
  if (!message) throw new RelayError(409, 'conversation_unavailable', 'This conversation is stopped or its workspace has reached the storage limit.');
  if (message.conversation_id !== existing.id || message.to_agent !== body.to || message.text !== body.message.trim()) throw new RelayError(409, 'idempotency_conflict', 'This key already identifies a different message.');
  return { conversation: await conversationView(env, (await conversationRow(env, actor, existing.id))), message: messageView(message), request: null, replay: !inserted.meta.changes };
}

/** Previewing never sweeps, claims, acknowledges, or changes last-seen state. */
export async function previewRequests(env: Env, agent: AgentRow, options: { limit?: number } = {}) {
  authenticated(env, { owner: false, agent });
  const rows = await env.DB.prepare(`SELECT j.* FROM jobs j WHERE j.workspace_id=?1 AND j.to_agent=?2 AND j.status='queued'
    AND j.type IN (SELECT value FROM json_each(?3)) AND (j.from_agent='owner' OR j.from_agent IN (SELECT value FROM json_each(?4)) OR EXISTS(SELECT 1 FROM json_each(?4) WHERE value='*'))
    AND NOT EXISTS (SELECT 1 FROM conversation_chains ch WHERE ch.workspace_id=j.workspace_id AND ch.root_id=j.chain_root_id AND ch.stopped_at IS NOT NULL)
    AND ${collaborationClaimSQL('j', '?2')}
    AND (j.expires_at IS NULL OR j.expires_at>=?5) ORDER BY j.priority DESC,j.created_at,j.id LIMIT ?6`).bind(workspaceId(env), agent.id, agent.can_work ? agent.work_types : '[]', agent.accept_from, Date.now(), clamp(Math.trunc(options.limit ?? 20), 1, 100)).all<JobRow>();
  return (rows.results ?? []).map(j => jobView(j));
}
export async function claimRequest(env: Env, agent: AgentRow, requestId: string, consumerId: string, now = Date.now()) {
  consumer(consumerId);
  const job = await getJobRow(env, requestId);
  if (!job || job.to_agent !== agent.id || !canSee({ owner: false, agent }, job)) throw new RelayError(404, 'not_found', 'No such directed request.');
  return claimNext(env, agent, now, undefined, requestId, consumerId);
}

export async function checkConversationInbox(env: Env, agent: AgentRow, consumerId: string, options: { limit?: number } = {}) {
  authenticated(env, { owner: false, agent }); consumer(consumerId);
  // Reading with a new consumer identity allocates no receipt or cursor. Only
  // acknowledgment registers it, where the database enforces the atomic limit.
  const rows = await env.DB.prepare(`SELECT c.id,COALESCE(r.cursor,0) cursor FROM conversations c LEFT JOIN conversation_receipts r
    ON r.workspace_id=c.workspace_id AND r.conversation_id=c.id AND r.agent_id=?2 AND r.consumer_id=?3
    WHERE c.workspace_id=?1 AND EXISTS(SELECT 1 FROM conversation_messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id AND (m.to_agent=?2 OR (m.kind='context' AND EXISTS(SELECT 1 FROM json_each(c.participants) WHERE value=?2))) AND m.from_agent<>?2 AND m.id>COALESCE(r.cursor,0))
    ORDER BY c.last_message_at,c.id LIMIT ?4`).bind(workspaceId(env), agent.id, consumerId, clamp(Math.trunc(options.limit ?? 20), 1, 100)).all<{ id: string; cursor: number }>();
  return { consumer_id: consumerId, conversations: await Promise.all((rows.results ?? []).map(async r => ({ ...(await readConversation(env, { owner: false, agent }, r.id, { after: r.cursor, limit: 20 })), acknowledged_cursor: r.cursor }))),
    instruction: 'After reading each page, call acknowledge_conversation with its conversation_id, this consumer_id, and next_cursor. Other consumers keep independent cursors. Use get_conversation for remaining pages.' };
}
async function acknowledgeConversationInternal(env: Env, agent: AgentRow, id: string, consumerId: string, cursor: number, now = Date.now()) {
  consumer(consumerId); await conversationRow(env, { owner: false, agent }, id);
  if (!Number.isSafeInteger(cursor) || cursor < 1 || !(await env.DB.prepare(`SELECT id FROM conversation_messages WHERE workspace_id=? AND conversation_id=? AND id=?`).bind(workspaceId(env), id, cursor).first())) throw new RelayError(400, 'invalid_cursor', 'Acknowledge an existing message cursor in this conversation.');
  try { await env.DB.batch([
    env.DB.prepare(`INSERT INTO conversation_receipts(workspace_id,conversation_id,agent_id,consumer_id,cursor,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(workspace_id,conversation_id,agent_id,consumer_id) DO UPDATE SET cursor=excluded.cursor,updated_at=MAX(updated_at,excluded.updated_at)
      WHERE excluded.cursor>conversation_receipts.cursor`).bind(workspaceId(env), id, agent.id, consumerId, cursor, now),
    env.DB.prepare(`UPDATE jobs SET retrieved_at=?1 WHERE workspace_id=?2 AND conversation_id=?3 AND from_agent=?4 AND retrieved_at IS NULL AND status IN ('completed','failed') AND EXISTS(SELECT 1 FROM conversation_messages m WHERE m.workspace_id=jobs.workspace_id AND m.request_id=jobs.id AND m.kind IN ('answer','failure') AND m.to_agent=?4 AND m.id<=?5 AND m.source_key=jobs.id||':result:'||jobs.attempts)`).bind(now, workspaceId(env), id, agent.id, cursor),
  ]); } catch (error) {
    if (error instanceof Error && error.message.includes('consumer_limit'))
      throw new RelayError(429, 'consumer_limit', 'This connection already has eight delivery consumers. Reuse an existing stable consumer_id for this interactive or scheduled client instead of creating one for each execution.');
    throw error;
  }
  const saved = await env.DB.prepare(`SELECT cursor FROM conversation_receipts WHERE workspace_id=? AND conversation_id=? AND agent_id=? AND consumer_id=?`).bind(workspaceId(env), id, agent.id, consumerId).first<{ cursor: number }>();
  return { conversation_id: id, consumer_id: consumerId, cursor: saved!.cursor };
}
export async function stopConversation(env: Env, actor: Actor, id: string, now = Date.now()) {
  if (!actor.owner) throw new RelayError(403, 'owner_only', 'Only the owner can stop a work chain.');
  const row = await conversationRow(env, actor, id);
  await env.DB.batch([
    env.DB.prepare(`UPDATE conversation_chains SET stopped_at=COALESCE(stopped_at,?) WHERE workspace_id=? AND root_id=?`).bind(now, workspaceId(env), row.chain_root_id),
    env.DB.prepare(`UPDATE conversations SET stopped_at=COALESCE(stopped_at,?) WHERE workspace_id=? AND chain_root_id=?`).bind(now, workspaceId(env), row.chain_root_id),
    env.DB.prepare(`UPDATE jobs SET status='canceled',lease_holder=NULL,lease_expires_at=NULL,lease_id=NULL,claim_consumer=NULL,completed_at=?1,updated_at=?1 WHERE workspace_id=?2 AND chain_root_id=?3 AND ${OPEN}`).bind(now, workspaceId(env), row.chain_root_id),
    env.DB.prepare(`UPDATE claims SET revoked_at=COALESCE(revoked_at,?1) WHERE workspace_id=?2 AND job_id IN (SELECT id FROM jobs WHERE workspace_id=?2 AND chain_root_id=?3)`).bind(now, workspaceId(env), row.chain_root_id),
    env.DB.prepare(`UPDATE wake_deliveries SET status='canceled',lease_token=NULL,lease_expires_at=NULL,updated_at=?1 WHERE workspace_id=?2 AND job_id IN (SELECT id FROM jobs WHERE workspace_id=?2 AND chain_root_id=?3) AND status IN ('pending','leased')`).bind(now, workspaceId(env), row.chain_root_id),
    env.DB.prepare(`INSERT INTO events(workspace_id,ts,actor,kind,detail) SELECT ?,?,'owner','conversation_stopped',? WHERE EXISTS (SELECT 1 FROM workspaces w LEFT JOIN workspace_storage_usage u ON u.workspace_id=w.id WHERE w.id=? AND COALESCE(u.accounted_bytes,0)+4096<=w.storage_limit_bytes) AND (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')+4096<=1610612736`).bind(workspaceId(env), now, JSON.stringify({ conversation_id: id, chain_root_id: row.chain_root_id }), workspaceId(env)),
  ]);
  return { conversation: await conversationView(env, await conversationRow(env, actor, id)), execution_note: 'Future relay dispatch and pending claims are stopped. Work already running inside a provider may need to be stopped there.' };
}
export async function extendConversation(env: Env, actor: Actor, id: string, options: { requests?: number; depth?: number }, now = Date.now()) {
  if (!actor.owner) throw new RelayError(403, 'owner_only', 'Only the owner can extend a work chain.');
  const row = await conversationRow(env, actor, id);
  const requests = options.requests ?? 10; const depth = options.depth ?? 0;
  if (!Number.isInteger(requests) || requests < 0 || requests > 100 || !Number.isInteger(depth) || depth < 0 || depth > 2 || requests + depth === 0) throw new RelayError(400, 'invalid_extension', 'Add 0–100 requests and 0–2 delegation levels, with at least one positive allowance.');
  await env.DB.batch([
    env.DB.prepare(`UPDATE conversation_chains SET max_requests=MIN(1000,max_requests+?),max_depth=MIN(10,max_depth+?) WHERE workspace_id=? AND root_id=?`).bind(requests, depth, workspaceId(env), row.chain_root_id),
    env.DB.prepare(`INSERT INTO events(workspace_id,ts,actor,kind,detail) VALUES(?,?,'owner','conversation_extended',?)`).bind(workspaceId(env), now, JSON.stringify({ conversation_id: id, added_requests: requests, added_depth: depth })),
  ]);
  return conversationView(env, row);
}

/** Retention removes a complete thread atomically; open requests protect every
 * message. Minimal job quota receipts remain for the existing 35-day policy. */
export async function pruneConversations(env: Env, now = Date.now()) {
  const eligible = `SELECT c.id FROM conversations c WHERE c.workspace_id=?1 AND c.last_message_at+c.retention_days*86400000<?2 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.workspace_id=c.workspace_id AND j.conversation_id=c.id AND ${OPEN}) ORDER BY c.last_message_at,c.id LIMIT 100`;
  await env.DB.prepare(`DELETE FROM conversations WHERE workspace_id=?1 AND id IN (${eligible})`).bind(workspaceId(env), now).run();
}

export function sendMessage(...args: Parameters<typeof sendMessageInternal>) { return withStorageBoundary(() => sendMessageInternal(...args)); }

export function updateConversationContext(...args: Parameters<typeof updateConversationContextInternal>) { return withStorageBoundary(() => updateConversationContextInternal(...args)); }

export function acknowledgeConversation(...args: Parameters<typeof acknowledgeConversationInternal>) { return withStorageBoundary(() => acknowledgeConversationInternal(...args)); }
