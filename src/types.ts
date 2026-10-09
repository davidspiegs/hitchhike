/**
 * Wire types for the relay protocol. These are the envelopes every agent sees.
 * Anything a requester or worker sends is data; authority comes only from the
 * relay (who you authenticated as) and from each agent's standing instructions.
 */

export const PROTOCOL_VERSION = "0.1";

export type JobStatus =
  | "needs_approval" // waiting for the owner to approve (e.g. build jobs)
  | "queued" // claimable by an eligible worker
  | "claimed" // a worker holds the lease
  | "input_required" // the worker asked the requester a question
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

export const TERMINAL_STATUSES: readonly JobStatus[] = ["completed", "failed", "canceled", "expired"];

/** Body of POST /v1/jobs. `from` is never accepted: the relay stamps it from the token. */
export interface JobRequest {
  v?: string;
  type: string; // must exist in the job-type registry
  to: string; // worker agent id, or "*" for any eligible worker
  title: string; // <= 120 chars; shows up in audit logs and in the worker's chat
  goal: string; // the task, written so a worker with none of your context can do it
  inputs?: Record<string, unknown>; // typed parameters: questions, urls, repo, since...
  constraints?: string[]; // plain-language limits: "US companies only", "max 20 sources"
  acceptance?: string[]; // what "done" means; the requester checks these
  output?: OutputSpec;
  artifacts?: ArtifactRef[]; // large inputs by reference, never inline megabytes
  priority?: number; // -10..10, higher is claimed first
  expires_in_minutes?: number; // dropped if not finished by then (default 3 days)
  lease_seconds?: number; // how long a worker holds it before it goes back in the queue
  max_attempts?: number; // work attempts before giving up; answered clarifications are separate (default 3)
  idempotency_key?: string; // same key from the same requester returns the same job
  parent_id?: string; // follow-up to an earlier job
}

export interface OutputSpec {
  format: "markdown" | "json";
  /** Bounded structural subset documented in docs/output-schemas.md. */
  schema?: Record<string, unknown>; // JSON Schema (2020-12) for `data` when format is "json"
  max_summary_chars?: number; // default 1200
}

export interface ArtifactRef {
  name: string;
  url: string; // https only
  mime?: string;
  sha256?: string;
  bytes?: number;
}

export interface Source {
  url: string;
  title?: string;
  note?: string;
}

/** What a worker sends back. Plain markdown is also accepted and parsed into this shape. */
export interface ResultSubmission {
  status?: "completed" | "failed" | "needs_input";
  summary?: string; // the part a busy requester reads first
  body?: string; // full markdown; fetched only on request
  data?: unknown; // structured output, validated against output.schema
  sources?: Source[];
  artifacts?: ArtifactRef[];
  question?: string; // when status is needs_input
  error?: string; // when status is failed
  confidence?: "low" | "medium" | "high";
}

/** A stored result. The relay stamps worker, time, validation, and provenance itself. */
export interface Result extends ResultSubmission {
  status: "completed" | "failed" | "needs_input";
  summary: string;
  worker: string;
  submitted_at: string;
  validation: { ok: boolean; errors: string[] };
  provenance: { untrusted: true; worker: string; job_type: string; note: string };
}

export interface ThreadEntry {
  at: string;
  from: string;
  kind: "question" | "reply" | "feedback";
  text: string;
}

/** A job as the relay returns it to requesters, workers, and the owner. */
export interface Job {
  id: string;
  requires_consumer?: boolean;
  conversation_id?: string | null;
  chain_root_id?: string | null;
  delegation_depth?: number;
  conversation_context?: ConversationContext;
  collaboration_configuration?: { version: number; settings: unknown; roster: unknown };
  v: string;
  type: string;
  from: string;
  to: string;
  title: string;
  status: JobStatus;
  priority: number;
  goal: string;
  inputs?: Record<string, unknown>;
  constraints?: string[];
  acceptance?: string[];
  output?: OutputSpec;
  artifacts?: ArtifactRef[];
  parent_id: string | null;
  thread: ThreadEntry[];
  attempts: number; // monotonically increasing claim generation; subtract clarification_rounds for work usage
  max_attempts: number;
  clarification_rounds: number; // answered question cycles, each grants one continuation claim
  max_clarification_rounds: number;
  lease: { holder: string; expires_at: string } | null;
  expires_at: string | null;
  result: (Result & { body_chars?: number }) | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  retrieved_at: string | null; // requester explicitly acknowledged receipt
}

export interface AuditEvent {
  id: number;
  ts: string;
  job_id: string | null;
  actor: string;
  kind: string;
  detail: Record<string, unknown> | null;
}

/** Immutable, attributed conversation content. IDs are sequence cursors, not times. */
export interface ConversationMessage {
  id: number;
  conversation_id: string;
  request_id: string | null;
  from: string;
  to: string;
  kind: "request" | "answer" | "question" | "reply" | "revision" | "note" | "failure" | "context";
  text: string;
  result: Result | null;
  context?: { previous_version: number; version: number; previous_text: string } | null;
  created_at: string;
}

export interface ConversationContext {
  conversation_id: string;
  pinned_context: string;
  context_version: number;
  context_requires_brief: boolean;
  messages: ConversationMessage[];
  omitted_message_count: number;
  truncated_message_ids: number[];
  history_url: string;
  instruction: string;
}
