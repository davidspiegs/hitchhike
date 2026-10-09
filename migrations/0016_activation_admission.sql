-- A dispatch winner owns one nonce; late work cannot overwrite a new owner.
ALTER TABLE activation_dispatches ADD COLUMN reservation_nonce TEXT;

-- Immutable, bounded operational history. No cascades: deleting requests,
-- connections or workspaces cannot refund a rolling provider-launch allowance.
CREATE TABLE activation_launch_attempts (
  dispatch_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  reservation_nonce TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  admitted_at INTEGER NOT NULL,
  PRIMARY KEY (dispatch_id,attempt)
);
CREATE INDEX activation_attempts_global ON activation_launch_attempts(admitted_at);
CREATE INDEX activation_attempts_workspace ON activation_launch_attempts(workspace_id,admitted_at);
CREATE INDEX activation_attempts_agent ON activation_launch_attempts(workspace_id,agent_id,admitted_at,job_id);

-- Preserve pre-migration spend conservatively. Legacy rows retained only their
-- last attempt time, so all (at most three) attempts use that latest timestamp.
INSERT INTO activation_launch_attempts(dispatch_id,attempt,reservation_nonce,workspace_id,agent_id,job_id,admitted_at)
  SELECT d.id,n.attempt,'migrated:'||d.id||':'||n.attempt,d.workspace_id,d.agent_id,d.job_id,d.updated_at
  FROM activation_dispatches d JOIN (SELECT 1 AS attempt UNION ALL SELECT 2 UNION ALL SELECT 3) n
    ON n.attempt<=d.attempts;

-- The guarded reservation UPDATE and quota debit form one SQLite transaction.
-- A losing dispatcher writes nothing and cannot consume another allowance.
CREATE TRIGGER activation_admission AFTER UPDATE OF status,attempts ON activation_dispatches
WHEN NEW.status='dispatching' AND OLD.status IN ('pending','rate_limited') AND NEW.attempts=OLD.attempts+1
BEGIN
  INSERT INTO activation_launch_attempts(dispatch_id,attempt,reservation_nonce,workspace_id,agent_id,job_id,admitted_at)
    VALUES (NEW.id,NEW.attempts,NEW.reservation_nonce,NEW.workspace_id,NEW.agent_id,NEW.job_id,NEW.updated_at);
END;
