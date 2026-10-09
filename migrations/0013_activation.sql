-- Separate fair rotation for the smaller provider-dispatch budget.
ALTER TABLE workspaces ADD COLUMN last_activation_at INTEGER NOT NULL DEFAULT 0;

-- Provider-specific launch credentials. No arbitrary HTTP targets or payloads.
CREATE TABLE activation_configs (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude_code_routine' CHECK (provider='claude_code_routine'),
  endpoint TEXT NOT NULL,
  token_ciphertext TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id,agent_id)
);

-- Reserving a launch precedes network I/O. An interrupted launch is uncertain,
-- not retryable: the provider has no idempotency support. Credential rotation
-- does not produce a new request generation or erase a launch reservation.
CREATE TABLE activation_dispatches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  config_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','dispatching','launched','rate_limited','uncertain','failed','canceled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  reserved_until INTEGER,
  http_status INTEGER,
  error_code TEXT,
  provider_session_id TEXT,
  provider_session_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (workspace_id,job_id,generation)
);
CREATE INDEX activation_dispatches_due ON activation_dispatches (workspace_id,status,next_attempt_at);
CREATE INDEX activation_dispatches_reserved ON activation_dispatches (workspace_id,status,reserved_until);
CREATE INDEX activation_dispatches_agent ON activation_dispatches (workspace_id,agent_id,created_at DESC);
CREATE INDEX activation_configs_enabled ON activation_configs (workspace_id,enabled,agent_id);
CREATE TRIGGER activation_delete_agent AFTER DELETE ON agents BEGIN
  DELETE FROM activation_configs WHERE workspace_id=OLD.workspace_id AND agent_id=OLD.id;
  DELETE FROM activation_dispatches WHERE workspace_id=OLD.workspace_id AND agent_id=OLD.id;
END;
CREATE TRIGGER activation_delete_job AFTER DELETE ON jobs BEGIN
  DELETE FROM activation_dispatches WHERE workspace_id=OLD.workspace_id AND job_id=OLD.id;
END;
CREATE TRIGGER activation_delete_workspace AFTER DELETE ON workspaces BEGIN
  DELETE FROM activation_configs WHERE workspace_id=OLD.id;
  DELETE FROM activation_dispatches WHERE workspace_id=OLD.id;
END;
