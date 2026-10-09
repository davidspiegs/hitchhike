-- Agents that can talk to the relay. Tokens are stored only as SHA-256 hashes.
CREATE TABLE agents (
  id               TEXT PRIMARY KEY,                -- short handle, e.g. "codex", "grok", "muse"
  name             TEXT NOT NULL,
  token_hash       TEXT NOT NULL UNIQUE,
  can_request      INTEGER NOT NULL DEFAULT 0,      -- may create jobs
  can_work         INTEGER NOT NULL DEFAULT 0,      -- may claim jobs
  work_types       TEXT NOT NULL DEFAULT '[]',      -- JSON array: job types this agent may claim
  request_targets  TEXT NOT NULL DEFAULT '["*"]',   -- JSON array: agent ids it may send to ("*" = any)
  accept_from      TEXT NOT NULL DEFAULT '["*"]',   -- JSON array: agent ids it takes jobs from ("*" = any)
  daily_job_limit  INTEGER NOT NULL DEFAULT 50,     -- jobs it may create per rolling 24h
  daily_work_limit INTEGER NOT NULL DEFAULT 50,     -- jobs it may claim per rolling 24h
  max_leases       INTEGER NOT NULL DEFAULT 1,      -- jobs it may hold at once
  wake_url         TEXT,                            -- optional doorbell, set by the owner only
  wake_headers     TEXT,                            -- JSON object of headers for the doorbell
  wake_body        TEXT,                            -- body template; {{job_id}} {{title}} {{type}} {{from}}
  created_at       INTEGER NOT NULL,
  last_seen_at     INTEGER
);

-- One row per unit of delegated work. `spec` holds the requester-supplied envelope.
CREATE TABLE jobs (
  id               TEXT PRIMARY KEY,
  v                TEXT NOT NULL,
  type             TEXT NOT NULL,
  from_agent       TEXT NOT NULL,                   -- stamped from auth, never from the body
  to_agent         TEXT NOT NULL,                   -- agent id, or "*" for any eligible worker
  title            TEXT NOT NULL,
  spec             TEXT NOT NULL,                   -- JSON: goal, inputs, constraints, acceptance, output, artifacts
  status           TEXT NOT NULL,                   -- needs_approval|queued|claimed|input_required|completed|failed|canceled|expired
  priority         INTEGER NOT NULL DEFAULT 0,
  idempotency_key  TEXT,
  parent_id        TEXT,
  thread           TEXT NOT NULL DEFAULT '[]',      -- JSON: questions, replies, rejection feedback
  lease_holder     TEXT,
  lease_seconds    INTEGER NOT NULL,
  lease_expires_at INTEGER,
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  invalid_submits  INTEGER NOT NULL DEFAULT 0,
  claims_valid_after INTEGER NOT NULL DEFAULT 0,    -- claim tokens issued before this can't submit (job was sent back)
  expires_at       INTEGER,
  result           TEXT,                            -- JSON result envelope (server-stamped fields included)
  result_by        TEXT,
  error            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  completed_at     INTEGER,
  UNIQUE (from_agent, idempotency_key)
);
CREATE INDEX jobs_claimable ON jobs (status, to_agent, priority DESC, created_at);
CREATE INDEX jobs_from ON jobs (from_agent, created_at DESC);
CREATE INDEX jobs_lease ON jobs (status, lease_expires_at);

-- Every claim token ever issued. The token itself is the capability to submit a result.
CREATE TABLE claims (
  token_hash TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  attempt    INTEGER NOT NULL,
  issued_at  INTEGER NOT NULL
);
CREATE INDEX claims_agent ON claims (agent_id, issued_at DESC);

-- Append-only audit trail of every cross-agent ask, claim, and answer.
CREATE TABLE events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  job_id TEXT,
  actor  TEXT NOT NULL,
  kind   TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX events_job ON events (job_id, id);

-- Recurring jobs (digests, monitors). The owner defines them; the relay instantiates them.
CREATE TABLE schedules (
  id            TEXT PRIMARY KEY,
  every_minutes INTEGER NOT NULL,
  template      TEXT NOT NULL,                      -- JSON: a job-create payload
  enabled       INTEGER NOT NULL DEFAULT 1,
  next_run_at   INTEGER NOT NULL,
  last_run_at   INTEGER,
  last_job_id   TEXT,
  created_at    INTEGER NOT NULL
);
