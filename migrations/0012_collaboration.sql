-- Additive, opt-in release settings. Existing connections keep their legacy ACLs.
ALTER TABLE workspaces ADD COLUMN next_release_beta INTEGER NOT NULL DEFAULT 0;

CREATE TABLE agent_collaboration (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, agent_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Human setup progress is never execution evidence. No credentials belong here.
CREATE TABLE agent_onboarding (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  surface TEXT NOT NULL,
  step TEXT NOT NULL DEFAULT 'choose',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, agent_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Only a server-side provider adapter may record authenticated run observations.
-- Owner configuration, read-only checks and agent-reported intervals cannot write proof.
CREATE TABLE collaboration_background_runs (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('scheduled', 'claude_routine')),
  request_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, agent_id, run_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE INDEX collaboration_runs_request ON collaboration_background_runs (workspace_id, request_id);
