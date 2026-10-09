-- Hosted tenants share one D1 database. Existing self-hosted data belongs to
-- "default"; identifiers remain unchanged for those existing integrations.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  retention_days INTEGER NOT NULL DEFAULT 30,
  connection_limit INTEGER NOT NULL DEFAULT 5,
  polling_worker_limit INTEGER NOT NULL DEFAULT 2,
  daily_job_limit INTEGER NOT NULL DEFAULT 10,
  monthly_job_limit INTEGER NOT NULL DEFAULT 100,
  storage_limit_bytes INTEGER NOT NULL DEFAULT 10485760,
  max_open_jobs INTEGER NOT NULL DEFAULT 20
);
INSERT INTO workspaces (id, name, created_at, connection_limit, polling_worker_limit,
  daily_job_limit, monthly_job_limit, storage_limit_bytes, max_open_jobs)
VALUES ('default', 'My agents', CAST(strftime('%s','now') AS INTEGER) * 1000, 2147483647, 2147483647,
  2147483647, 2147483647, 9007199254740991, 2147483647);

ALTER TABLE agents ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE agents ADD COLUMN handle TEXT;
ALTER TABLE agents ADD COLUMN auth_generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agents ADD COLUMN inbox_pending_cursor INTEGER NOT NULL DEFAULT 0;
UPDATE agents SET handle=id;
-- The old value was a timestamp; the retry-safe inbox uses event IDs.
UPDATE agents SET inbox_cursor=0;
CREATE UNIQUE INDEX agents_workspace_handle ON agents (workspace_id, handle);
CREATE INDEX agents_workspace ON agents (workspace_id, created_at);

-- Rebuild to replace the old global requester/idempotency uniqueness rule.
CREATE TABLE jobs_v3 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  v TEXT NOT NULL,
  type TEXT NOT NULL,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  title TEXT NOT NULL,
  spec TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  parent_id TEXT,
  thread TEXT NOT NULL DEFAULT '[]',
  lease_holder TEXT,
  lease_seconds INTEGER NOT NULL,
  lease_expires_at INTEGER,
  lease_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  invalid_submits INTEGER NOT NULL DEFAULT 0,
  claims_valid_after INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  result TEXT,
  result_by TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  retrieved_at INTEGER,
  UNIQUE (workspace_id, from_agent, idempotency_key)
);
INSERT INTO jobs_v3 (id,v,type,from_agent,to_agent,title,spec,status,priority,idempotency_key,parent_id,thread,
  lease_holder,lease_seconds,lease_expires_at,attempts,max_attempts,invalid_submits,claims_valid_after,expires_at,
  result,result_by,error,created_at,updated_at,completed_at)
SELECT id,v,type,from_agent,to_agent,title,spec,status,priority,idempotency_key,parent_id,thread,
  lease_holder,lease_seconds,lease_expires_at,attempts,max_attempts,invalid_submits,claims_valid_after,expires_at,
  result,result_by,error,created_at,updated_at,completed_at FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_v3 RENAME TO jobs;
CREATE INDEX jobs_claimable ON jobs (workspace_id,status,to_agent,priority DESC,created_at);
CREATE INDEX jobs_from ON jobs (workspace_id,from_agent,created_at DESC);
CREATE INDEX jobs_created ON jobs (workspace_id,created_at);
CREATE INDEX jobs_lease ON jobs (workspace_id,status,lease_holder,lease_expires_at);
CREATE INDEX jobs_completed ON jobs (workspace_id,completed_at);
CREATE INDEX jobs_results ON jobs (workspace_id,result_by,status);

ALTER TABLE claims ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE claims ADD COLUMN auth_generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE claims ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE claims ADD COLUMN revoked_at INTEGER;
UPDATE claims SET expires_at=COALESCE((SELECT lease_expires_at FROM jobs WHERE jobs.id=claims.job_id),0);
CREATE INDEX claims_workspace_agent ON claims (workspace_id,agent_id,issued_at DESC);
CREATE INDEX claims_workspace_job ON claims (workspace_id,job_id);
CREATE INDEX claims_expiry ON claims (workspace_id,expires_at);

ALTER TABLE events ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX events_workspace ON events (workspace_id,id);
CREATE INDEX events_retention ON events (workspace_id,ts);

CREATE TABLE schedules_v3 (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  every_minutes INTEGER NOT NULL,
  template TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_job_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id,id)
);
INSERT INTO schedules_v3 (id,every_minutes,template,enabled,next_run_at,last_run_at,last_job_id,created_at)
SELECT id,every_minutes,template,enabled,next_run_at,last_run_at,last_job_id,created_at FROM schedules;
DROP TABLE schedules;
ALTER TABLE schedules_v3 RENAME TO schedules;
CREATE INDEX schedules_due ON schedules (workspace_id,enabled,next_run_at);
