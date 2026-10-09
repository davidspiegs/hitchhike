-- Conservative retained-storage accounting. This is an application budget, not
-- a measurement of physical D1 pages: every row costs 1024 bytes plus twice its
-- UTF-8 text bytes, reserving at least 512 bytes for each listed lifecycle field.
-- All owner/agent-controlled workspace metadata and associated content copies
-- count, including idempotency keys, receipts, claims and retained launch records.
-- Auth clients/sessions/codes/tokens and control-plane deletion/tombstone records
-- are independently cardinality-bounded; this ledger does not join through their
-- mutable parents. A workspace's own base row reserves routine control overhead.
-- Positive growth is checked AFTER changing the ledger in the SAME transaction:
-- ABORT rolls back the initiating statement, including nested transcript writes.
-- Conditional SELECT RAISE guards avoid nested END terminators in trigger bodies,
-- keeping the statements compatible with simpler remote SQL splitters.
-- Zero/reducing updates and deletes remain possible for an over-budget workspace.
-- Existing rows are backfilled unchanged BEFORE enforcement is installed.

CREATE TABLE workspace_storage_usage (
  workspace_id TEXT PRIMARY KEY,
  accounted_bytes INTEGER NOT NULL CHECK(accounted_bytes >= 0)
);
-- No cascade: retained launch evidence can outlive its workspace. Its accounted
-- bytes remain in the shared total until its independent retention removes it.
-- Separate aggregate statements stay below D1's compound-SELECT limit.
-- Migration execution is atomic; enforcement starts only after every backfill.
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT id,SUM(1024+2*(COALESCE(length(CAST(id AS BLOB)),0)+COALESCE(length(CAST(name AS BLOB)),0))) FROM workspaces GROUP BY id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(id AS BLOB)),0)+COALESCE(length(CAST(google_sub AS BLOB)),0)+COALESCE(length(CAST(email AS BLOB)),0)+COALESCE(length(CAST(name AS BLOB)),0)+COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(identity_hash AS BLOB)),0)))) FROM users GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(id AS BLOB)),0)+COALESCE(length(CAST(name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(token_hash AS BLOB)),0))+COALESCE(length(CAST(work_types AS BLOB)),0)+COALESCE(length(CAST(request_targets AS BLOB)),0)+COALESCE(length(CAST(accept_from AS BLOB)),0)+COALESCE(length(CAST(wake_url AS BLOB)),0)+COALESCE(length(CAST(wake_headers AS BLOB)),0)+COALESCE(length(CAST(wake_body AS BLOB)),0)+COALESCE(length(CAST(platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(handle AS BLOB)),0))) FROM agents GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(id AS BLOB)),0)+COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(v AS BLOB)),0)+COALESCE(length(CAST(type AS BLOB)),0)+COALESCE(length(CAST(from_agent AS BLOB)),0)+COALESCE(length(CAST(to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(title AS BLOB)),0))+COALESCE(length(CAST(spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(status AS BLOB)),0))+COALESCE(length(CAST(idempotency_key AS BLOB)),0)+COALESCE(length(CAST(parent_id AS BLOB)),0)+COALESCE(length(CAST(thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(lease_id AS BLOB)),0))+COALESCE(length(CAST(result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(error AS BLOB)),0))+COALESCE(length(CAST(conversation_id AS BLOB)),0)+COALESCE(length(CAST(chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(claim_consumer AS BLOB)),0)))) FROM jobs GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(MAX(512,COALESCE(length(CAST(token_hash AS BLOB)),0))+COALESCE(length(CAST(job_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0)+COALESCE(length(CAST(workspace_id AS BLOB)),0))) FROM claims GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(job_id AS BLOB)),0)+COALESCE(length(CAST(actor AS BLOB)),0)+COALESCE(length(CAST(kind AS BLOB)),0)+COALESCE(length(CAST(detail AS BLOB)),0)+COALESCE(length(CAST(workspace_id AS BLOB)),0))) FROM events GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(id AS BLOB)),0)+COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(template AS BLOB)),0)+COALESCE(length(CAST(last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(disabled_reason AS BLOB)),0)))) FROM schedules GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(id AS BLOB)),0)+COALESCE(length(CAST(user_id AS BLOB)),0)+COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0)+COALESCE(length(CAST(client_id AS BLOB)),0)+COALESCE(length(CAST(scope AS BLOB)),0)+COALESCE(length(CAST(resource AS BLOB)),0))) FROM oauth_grants GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(code_hash AS BLOB)),0)+COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0))) FROM pairing_codes GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(job_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(last_error AS BLOB)),0)))) FROM wake_deliveries GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(root_id AS BLOB)),0))) FROM conversation_chains GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(title AS BLOB)),0))+COALESCE(length(CAST(participants AS BLOB)),0)+COALESCE(length(CAST(chain_root_id AS BLOB)),0)+COALESCE(length(CAST(pinned_context AS BLOB)),0))) FROM conversations GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(conversation_id AS BLOB)),0)+COALESCE(length(CAST(request_id AS BLOB)),0)+COALESCE(length(CAST(from_agent AS BLOB)),0)+COALESCE(length(CAST(to_agent AS BLOB)),0)+COALESCE(length(CAST(kind AS BLOB)),0)+COALESCE(length(CAST(text AS BLOB)),0)+COALESCE(length(CAST(result AS BLOB)),0)+COALESCE(length(CAST(context AS BLOB)),0)+COALESCE(length(CAST(source_key AS BLOB)),0))) FROM conversation_messages GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(conversation_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0)+COALESCE(length(CAST(consumer_id AS BLOB)),0))) FROM conversation_receipts GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0)+COALESCE(length(CAST(settings AS BLOB)),0))) FROM agent_collaboration GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0)+COALESCE(length(CAST(provider AS BLOB)),0)+COALESCE(length(CAST(surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(step AS BLOB)),0)))) FROM agent_onboarding GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0)+COALESCE(length(CAST(run_id AS BLOB)),0)+COALESCE(length(CAST(method AS BLOB)),0)+COALESCE(length(CAST(request_id AS BLOB)),0))) FROM collaboration_background_runs GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0)+COALESCE(length(CAST(provider AS BLOB)),0)+COALESCE(length(CAST(endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(token_ciphertext AS BLOB)),0)))) FROM activation_configs GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(id AS BLOB)),0)+COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(job_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0)+COALESCE(length(CAST(generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(reservation_nonce AS BLOB)),0)))) FROM activation_dispatches GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes)
SELECT workspace_id,SUM(1024+2*(COALESCE(length(CAST(dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(workspace_id AS BLOB)),0)+COALESCE(length(CAST(agent_id AS BLOB)),0)+COALESCE(length(CAST(job_id AS BLOB)),0))) FROM activation_launch_attempts GROUP BY workspace_id
ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;

-- workspaces: text columns id, name.
CREATE TRIGGER storage_workspaces_insert AFTER INSERT ON workspaces BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_workspaces_update AFTER UPDATE ON workspaces
WHEN NEW.id IS NOT OLD.id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0))) WHERE workspace_id=OLD.id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.id IS NOT OLD.id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.id<>'default' AND (OLD.id='default' OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.id);
END;
CREATE TRIGGER storage_workspaces_delete AFTER DELETE ON workspaces BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0))) WHERE workspace_id=OLD.id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.id);
END;

-- users: text columns id, google_sub, email, name, workspace_id, identity_key, identity_hash.
CREATE TRIGGER storage_users_insert AFTER INSERT ON users BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.google_sub AS BLOB)),0)+COALESCE(length(CAST(NEW.email AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.identity_hash AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_users_update AFTER UPDATE ON users
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.google_sub AS BLOB)),0)+COALESCE(length(CAST(NEW.email AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.identity_hash AS BLOB)),0))))<>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.google_sub AS BLOB)),0)+COALESCE(length(CAST(OLD.email AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.identity_hash AS BLOB)),0)))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.google_sub AS BLOB)),0)+COALESCE(length(CAST(OLD.email AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.identity_hash AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.google_sub AS BLOB)),0)+COALESCE(length(CAST(NEW.email AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.identity_hash AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.google_sub AS BLOB)),0)+COALESCE(length(CAST(NEW.email AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.identity_hash AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.google_sub AS BLOB)),0)+COALESCE(length(CAST(OLD.email AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.identity_hash AS BLOB)),0))))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.google_sub AS BLOB)),0)+COALESCE(length(CAST(NEW.email AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.identity_hash AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.google_sub AS BLOB)),0)+COALESCE(length(CAST(OLD.email AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.identity_hash AS BLOB)),0))))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_users_delete AFTER DELETE ON users BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.google_sub AS BLOB)),0)+COALESCE(length(CAST(OLD.email AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.identity_key AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.identity_hash AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- agents: text columns id, name, token_hash, work_types, request_targets, accept_from, wake_url, wake_headers, wake_body, platform, key_ciphertext, workspace_id, handle.
CREATE TRIGGER storage_agents_insert AFTER INSERT ON agents BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.token_hash AS BLOB)),0))+COALESCE(length(CAST(NEW.work_types AS BLOB)),0)+COALESCE(length(CAST(NEW.request_targets AS BLOB)),0)+COALESCE(length(CAST(NEW.accept_from AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_url AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_headers AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_body AS BLOB)),0)+COALESCE(length(CAST(NEW.platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.handle AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_agents_update AFTER UPDATE ON agents
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.token_hash AS BLOB)),0))+COALESCE(length(CAST(NEW.work_types AS BLOB)),0)+COALESCE(length(CAST(NEW.request_targets AS BLOB)),0)+COALESCE(length(CAST(NEW.accept_from AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_url AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_headers AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_body AS BLOB)),0)+COALESCE(length(CAST(NEW.platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.handle AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.token_hash AS BLOB)),0))+COALESCE(length(CAST(OLD.work_types AS BLOB)),0)+COALESCE(length(CAST(OLD.request_targets AS BLOB)),0)+COALESCE(length(CAST(OLD.accept_from AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_url AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_headers AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_body AS BLOB)),0)+COALESCE(length(CAST(OLD.platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.handle AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.token_hash AS BLOB)),0))+COALESCE(length(CAST(OLD.work_types AS BLOB)),0)+COALESCE(length(CAST(OLD.request_targets AS BLOB)),0)+COALESCE(length(CAST(OLD.accept_from AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_url AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_headers AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_body AS BLOB)),0)+COALESCE(length(CAST(OLD.platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.handle AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.token_hash AS BLOB)),0))+COALESCE(length(CAST(NEW.work_types AS BLOB)),0)+COALESCE(length(CAST(NEW.request_targets AS BLOB)),0)+COALESCE(length(CAST(NEW.accept_from AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_url AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_headers AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_body AS BLOB)),0)+COALESCE(length(CAST(NEW.platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.handle AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.token_hash AS BLOB)),0))+COALESCE(length(CAST(NEW.work_types AS BLOB)),0)+COALESCE(length(CAST(NEW.request_targets AS BLOB)),0)+COALESCE(length(CAST(NEW.accept_from AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_url AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_headers AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_body AS BLOB)),0)+COALESCE(length(CAST(NEW.platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.handle AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.token_hash AS BLOB)),0))+COALESCE(length(CAST(OLD.work_types AS BLOB)),0)+COALESCE(length(CAST(OLD.request_targets AS BLOB)),0)+COALESCE(length(CAST(OLD.accept_from AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_url AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_headers AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_body AS BLOB)),0)+COALESCE(length(CAST(OLD.platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.handle AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.token_hash AS BLOB)),0))+COALESCE(length(CAST(NEW.work_types AS BLOB)),0)+COALESCE(length(CAST(NEW.request_targets AS BLOB)),0)+COALESCE(length(CAST(NEW.accept_from AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_url AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_headers AS BLOB)),0)+COALESCE(length(CAST(NEW.wake_body AS BLOB)),0)+COALESCE(length(CAST(NEW.platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.handle AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.token_hash AS BLOB)),0))+COALESCE(length(CAST(OLD.work_types AS BLOB)),0)+COALESCE(length(CAST(OLD.request_targets AS BLOB)),0)+COALESCE(length(CAST(OLD.accept_from AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_url AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_headers AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_body AS BLOB)),0)+COALESCE(length(CAST(OLD.platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.handle AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_agents_delete AFTER DELETE ON agents BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.name AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.token_hash AS BLOB)),0))+COALESCE(length(CAST(OLD.work_types AS BLOB)),0)+COALESCE(length(CAST(OLD.request_targets AS BLOB)),0)+COALESCE(length(CAST(OLD.accept_from AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_url AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_headers AS BLOB)),0)+COALESCE(length(CAST(OLD.wake_body AS BLOB)),0)+COALESCE(length(CAST(OLD.platform AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.key_ciphertext AS BLOB)),0))+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.handle AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- jobs: text columns id, workspace_id, v, type, from_agent, to_agent, title, spec, status, idempotency_key, parent_id, thread, lease_holder, lease_id, result, result_by, error, conversation_id, chain_root_id, claim_consumer.
CREATE TRIGGER storage_jobs_insert AFTER INSERT ON jobs BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.v AS BLOB)),0)+COALESCE(length(CAST(NEW.type AS BLOB)),0)+COALESCE(length(CAST(NEW.from_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.title AS BLOB)),0))+COALESCE(length(CAST(NEW.spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+COALESCE(length(CAST(NEW.idempotency_key AS BLOB)),0)+COALESCE(length(CAST(NEW.parent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.lease_id AS BLOB)),0))+COALESCE(length(CAST(NEW.result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.error AS BLOB)),0))+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.claim_consumer AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_jobs_update AFTER UPDATE ON jobs
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.v AS BLOB)),0)+COALESCE(length(CAST(NEW.type AS BLOB)),0)+COALESCE(length(CAST(NEW.from_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.title AS BLOB)),0))+COALESCE(length(CAST(NEW.spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+COALESCE(length(CAST(NEW.idempotency_key AS BLOB)),0)+COALESCE(length(CAST(NEW.parent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.lease_id AS BLOB)),0))+COALESCE(length(CAST(NEW.result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.error AS BLOB)),0))+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.claim_consumer AS BLOB)),0))))<>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.v AS BLOB)),0)+COALESCE(length(CAST(OLD.type AS BLOB)),0)+COALESCE(length(CAST(OLD.from_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.title AS BLOB)),0))+COALESCE(length(CAST(OLD.spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+COALESCE(length(CAST(OLD.idempotency_key AS BLOB)),0)+COALESCE(length(CAST(OLD.parent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.lease_id AS BLOB)),0))+COALESCE(length(CAST(OLD.result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.error AS BLOB)),0))+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.claim_consumer AS BLOB)),0)))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.v AS BLOB)),0)+COALESCE(length(CAST(OLD.type AS BLOB)),0)+COALESCE(length(CAST(OLD.from_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.title AS BLOB)),0))+COALESCE(length(CAST(OLD.spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+COALESCE(length(CAST(OLD.idempotency_key AS BLOB)),0)+COALESCE(length(CAST(OLD.parent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.lease_id AS BLOB)),0))+COALESCE(length(CAST(OLD.result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.error AS BLOB)),0))+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.claim_consumer AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.v AS BLOB)),0)+COALESCE(length(CAST(NEW.type AS BLOB)),0)+COALESCE(length(CAST(NEW.from_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.title AS BLOB)),0))+COALESCE(length(CAST(NEW.spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+COALESCE(length(CAST(NEW.idempotency_key AS BLOB)),0)+COALESCE(length(CAST(NEW.parent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.lease_id AS BLOB)),0))+COALESCE(length(CAST(NEW.result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.error AS BLOB)),0))+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.claim_consumer AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.v AS BLOB)),0)+COALESCE(length(CAST(NEW.type AS BLOB)),0)+COALESCE(length(CAST(NEW.from_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.title AS BLOB)),0))+COALESCE(length(CAST(NEW.spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+COALESCE(length(CAST(NEW.idempotency_key AS BLOB)),0)+COALESCE(length(CAST(NEW.parent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.lease_id AS BLOB)),0))+COALESCE(length(CAST(NEW.result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.error AS BLOB)),0))+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.claim_consumer AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.v AS BLOB)),0)+COALESCE(length(CAST(OLD.type AS BLOB)),0)+COALESCE(length(CAST(OLD.from_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.title AS BLOB)),0))+COALESCE(length(CAST(OLD.spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+COALESCE(length(CAST(OLD.idempotency_key AS BLOB)),0)+COALESCE(length(CAST(OLD.parent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.lease_id AS BLOB)),0))+COALESCE(length(CAST(OLD.result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.error AS BLOB)),0))+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.claim_consumer AS BLOB)),0))))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.v AS BLOB)),0)+COALESCE(length(CAST(NEW.type AS BLOB)),0)+COALESCE(length(CAST(NEW.from_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.title AS BLOB)),0))+COALESCE(length(CAST(NEW.spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+COALESCE(length(CAST(NEW.idempotency_key AS BLOB)),0)+COALESCE(length(CAST(NEW.parent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.lease_id AS BLOB)),0))+COALESCE(length(CAST(NEW.result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.error AS BLOB)),0))+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.claim_consumer AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.v AS BLOB)),0)+COALESCE(length(CAST(OLD.type AS BLOB)),0)+COALESCE(length(CAST(OLD.from_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.title AS BLOB)),0))+COALESCE(length(CAST(OLD.spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+COALESCE(length(CAST(OLD.idempotency_key AS BLOB)),0)+COALESCE(length(CAST(OLD.parent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.lease_id AS BLOB)),0))+COALESCE(length(CAST(OLD.result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.error AS BLOB)),0))+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.claim_consumer AS BLOB)),0))))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_jobs_delete AFTER DELETE ON jobs BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.v AS BLOB)),0)+COALESCE(length(CAST(OLD.type AS BLOB)),0)+COALESCE(length(CAST(OLD.from_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.to_agent AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.title AS BLOB)),0))+COALESCE(length(CAST(OLD.spec AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+COALESCE(length(CAST(OLD.idempotency_key AS BLOB)),0)+COALESCE(length(CAST(OLD.parent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.thread AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.lease_holder AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.lease_id AS BLOB)),0))+COALESCE(length(CAST(OLD.result AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.result_by AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.error AS BLOB)),0))+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.chain_root_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.claim_consumer AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- claims: text columns token_hash, job_id, agent_id, workspace_id.
CREATE TRIGGER storage_claims_insert AFTER INSERT ON claims BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(MAX(512,COALESCE(length(CAST(NEW.token_hash AS BLOB)),0))+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_claims_update AFTER UPDATE ON claims
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(MAX(512,COALESCE(length(CAST(NEW.token_hash AS BLOB)),0))+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)))<>(1024+2*(MAX(512,COALESCE(length(CAST(OLD.token_hash AS BLOB)),0))+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(MAX(512,COALESCE(length(CAST(OLD.token_hash AS BLOB)),0))+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(MAX(512,COALESCE(length(CAST(NEW.token_hash AS BLOB)),0))+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(MAX(512,COALESCE(length(CAST(NEW.token_hash AS BLOB)),0))+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)))>(1024+2*(MAX(512,COALESCE(length(CAST(OLD.token_hash AS BLOB)),0))+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(MAX(512,COALESCE(length(CAST(NEW.token_hash AS BLOB)),0))+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)))>(1024+2*(MAX(512,COALESCE(length(CAST(OLD.token_hash AS BLOB)),0))+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_claims_delete AFTER DELETE ON claims BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(MAX(512,COALESCE(length(CAST(OLD.token_hash AS BLOB)),0))+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- events: text columns job_id, actor, kind, detail, workspace_id.
CREATE TRIGGER storage_events_insert AFTER INSERT ON events BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.actor AS BLOB)),0)+COALESCE(length(CAST(NEW.kind AS BLOB)),0)+COALESCE(length(CAST(NEW.detail AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_events_update AFTER UPDATE ON events
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.actor AS BLOB)),0)+COALESCE(length(CAST(NEW.kind AS BLOB)),0)+COALESCE(length(CAST(NEW.detail AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.actor AS BLOB)),0)+COALESCE(length(CAST(OLD.kind AS BLOB)),0)+COALESCE(length(CAST(OLD.detail AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.actor AS BLOB)),0)+COALESCE(length(CAST(OLD.kind AS BLOB)),0)+COALESCE(length(CAST(OLD.detail AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.actor AS BLOB)),0)+COALESCE(length(CAST(NEW.kind AS BLOB)),0)+COALESCE(length(CAST(NEW.detail AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.actor AS BLOB)),0)+COALESCE(length(CAST(NEW.kind AS BLOB)),0)+COALESCE(length(CAST(NEW.detail AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.actor AS BLOB)),0)+COALESCE(length(CAST(OLD.kind AS BLOB)),0)+COALESCE(length(CAST(OLD.detail AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.actor AS BLOB)),0)+COALESCE(length(CAST(NEW.kind AS BLOB)),0)+COALESCE(length(CAST(NEW.detail AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.actor AS BLOB)),0)+COALESCE(length(CAST(OLD.kind AS BLOB)),0)+COALESCE(length(CAST(OLD.detail AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_events_delete AFTER DELETE ON events BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.actor AS BLOB)),0)+COALESCE(length(CAST(OLD.kind AS BLOB)),0)+COALESCE(length(CAST(OLD.detail AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- schedules: text columns id, workspace_id, template, last_job_id, attempt_token, last_error, disabled_reason.
CREATE TRIGGER storage_schedules_insert AFTER INSERT ON schedules BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.template AS BLOB)),0)+COALESCE(length(CAST(NEW.last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.disabled_reason AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_schedules_update AFTER UPDATE ON schedules
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.template AS BLOB)),0)+COALESCE(length(CAST(NEW.last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.disabled_reason AS BLOB)),0))))<>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.template AS BLOB)),0)+COALESCE(length(CAST(OLD.last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.disabled_reason AS BLOB)),0)))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.template AS BLOB)),0)+COALESCE(length(CAST(OLD.last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.disabled_reason AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.template AS BLOB)),0)+COALESCE(length(CAST(NEW.last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.disabled_reason AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.template AS BLOB)),0)+COALESCE(length(CAST(NEW.last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.disabled_reason AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.template AS BLOB)),0)+COALESCE(length(CAST(OLD.last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.disabled_reason AS BLOB)),0))))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.template AS BLOB)),0)+COALESCE(length(CAST(NEW.last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.disabled_reason AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.template AS BLOB)),0)+COALESCE(length(CAST(OLD.last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.disabled_reason AS BLOB)),0))))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_schedules_delete AFTER DELETE ON schedules BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.template AS BLOB)),0)+COALESCE(length(CAST(OLD.last_job_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.attempt_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.last_error AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.disabled_reason AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- oauth_grants: text columns id, user_id, workspace_id, agent_id, client_id, scope, resource.
CREATE TRIGGER storage_oauth_grants_insert AFTER INSERT ON oauth_grants BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.user_id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.client_id AS BLOB)),0)+COALESCE(length(CAST(NEW.scope AS BLOB)),0)+COALESCE(length(CAST(NEW.resource AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_oauth_grants_update AFTER UPDATE ON oauth_grants
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.user_id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.client_id AS BLOB)),0)+COALESCE(length(CAST(NEW.scope AS BLOB)),0)+COALESCE(length(CAST(NEW.resource AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.user_id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.client_id AS BLOB)),0)+COALESCE(length(CAST(OLD.scope AS BLOB)),0)+COALESCE(length(CAST(OLD.resource AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.user_id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.client_id AS BLOB)),0)+COALESCE(length(CAST(OLD.scope AS BLOB)),0)+COALESCE(length(CAST(OLD.resource AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.user_id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.client_id AS BLOB)),0)+COALESCE(length(CAST(NEW.scope AS BLOB)),0)+COALESCE(length(CAST(NEW.resource AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.user_id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.client_id AS BLOB)),0)+COALESCE(length(CAST(NEW.scope AS BLOB)),0)+COALESCE(length(CAST(NEW.resource AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.user_id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.client_id AS BLOB)),0)+COALESCE(length(CAST(OLD.scope AS BLOB)),0)+COALESCE(length(CAST(OLD.resource AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.user_id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.client_id AS BLOB)),0)+COALESCE(length(CAST(NEW.scope AS BLOB)),0)+COALESCE(length(CAST(NEW.resource AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.user_id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.client_id AS BLOB)),0)+COALESCE(length(CAST(OLD.scope AS BLOB)),0)+COALESCE(length(CAST(OLD.resource AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_oauth_grants_delete AFTER DELETE ON oauth_grants BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.user_id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.client_id AS BLOB)),0)+COALESCE(length(CAST(OLD.scope AS BLOB)),0)+COALESCE(length(CAST(OLD.resource AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- pairing_codes: text columns code_hash, workspace_id, agent_id.
CREATE TRIGGER storage_pairing_codes_insert AFTER INSERT ON pairing_codes BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.code_hash AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_pairing_codes_update AFTER UPDATE ON pairing_codes
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.code_hash AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.code_hash AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.code_hash AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.code_hash AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.code_hash AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.code_hash AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.code_hash AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.code_hash AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_pairing_codes_delete AFTER DELETE ON pairing_codes BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.code_hash AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- wake_deliveries: text columns workspace_id, job_id, agent_id, status, lease_token, last_error.
CREATE TRIGGER storage_wake_deliveries_insert AFTER INSERT ON wake_deliveries BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.last_error AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_wake_deliveries_update AFTER UPDATE ON wake_deliveries
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.last_error AS BLOB)),0))))<>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.last_error AS BLOB)),0)))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.last_error AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.last_error AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.last_error AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.last_error AS BLOB)),0))))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.last_error AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.last_error AS BLOB)),0))))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_wake_deliveries_delete AFTER DELETE ON wake_deliveries BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.lease_token AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.last_error AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- conversation_chains: text columns workspace_id, root_id.
CREATE TRIGGER storage_conversation_chains_insert AFTER INSERT ON conversation_chains BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.root_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_conversation_chains_update AFTER UPDATE ON conversation_chains
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.root_id AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.root_id AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.root_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.root_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.root_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.root_id AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.root_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.root_id AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_conversation_chains_delete AFTER DELETE ON conversation_chains BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.root_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- conversations: text columns workspace_id, id, title, participants, chain_root_id, pinned_context.
CREATE TRIGGER storage_conversations_insert AFTER INSERT ON conversations BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.title AS BLOB)),0))+COALESCE(length(CAST(NEW.participants AS BLOB)),0)+COALESCE(length(CAST(NEW.chain_root_id AS BLOB)),0)+COALESCE(length(CAST(NEW.pinned_context AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_conversations_update AFTER UPDATE ON conversations
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.title AS BLOB)),0))+COALESCE(length(CAST(NEW.participants AS BLOB)),0)+COALESCE(length(CAST(NEW.chain_root_id AS BLOB)),0)+COALESCE(length(CAST(NEW.pinned_context AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.title AS BLOB)),0))+COALESCE(length(CAST(OLD.participants AS BLOB)),0)+COALESCE(length(CAST(OLD.chain_root_id AS BLOB)),0)+COALESCE(length(CAST(OLD.pinned_context AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.title AS BLOB)),0))+COALESCE(length(CAST(OLD.participants AS BLOB)),0)+COALESCE(length(CAST(OLD.chain_root_id AS BLOB)),0)+COALESCE(length(CAST(OLD.pinned_context AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.title AS BLOB)),0))+COALESCE(length(CAST(NEW.participants AS BLOB)),0)+COALESCE(length(CAST(NEW.chain_root_id AS BLOB)),0)+COALESCE(length(CAST(NEW.pinned_context AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.title AS BLOB)),0))+COALESCE(length(CAST(NEW.participants AS BLOB)),0)+COALESCE(length(CAST(NEW.chain_root_id AS BLOB)),0)+COALESCE(length(CAST(NEW.pinned_context AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.title AS BLOB)),0))+COALESCE(length(CAST(OLD.participants AS BLOB)),0)+COALESCE(length(CAST(OLD.chain_root_id AS BLOB)),0)+COALESCE(length(CAST(OLD.pinned_context AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.title AS BLOB)),0))+COALESCE(length(CAST(NEW.participants AS BLOB)),0)+COALESCE(length(CAST(NEW.chain_root_id AS BLOB)),0)+COALESCE(length(CAST(NEW.pinned_context AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.title AS BLOB)),0))+COALESCE(length(CAST(OLD.participants AS BLOB)),0)+COALESCE(length(CAST(OLD.chain_root_id AS BLOB)),0)+COALESCE(length(CAST(OLD.pinned_context AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_conversations_delete AFTER DELETE ON conversations BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.title AS BLOB)),0))+COALESCE(length(CAST(OLD.participants AS BLOB)),0)+COALESCE(length(CAST(OLD.chain_root_id AS BLOB)),0)+COALESCE(length(CAST(OLD.pinned_context AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- conversation_messages: text columns workspace_id, conversation_id, request_id, from_agent, to_agent, kind, text, result, context, source_key.
CREATE TRIGGER storage_conversation_messages_insert AFTER INSERT ON conversation_messages BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.request_id AS BLOB)),0)+COALESCE(length(CAST(NEW.from_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.to_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.kind AS BLOB)),0)+COALESCE(length(CAST(NEW.text AS BLOB)),0)+COALESCE(length(CAST(NEW.result AS BLOB)),0)+COALESCE(length(CAST(NEW.context AS BLOB)),0)+COALESCE(length(CAST(NEW.source_key AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_conversation_messages_update AFTER UPDATE ON conversation_messages
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.request_id AS BLOB)),0)+COALESCE(length(CAST(NEW.from_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.to_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.kind AS BLOB)),0)+COALESCE(length(CAST(NEW.text AS BLOB)),0)+COALESCE(length(CAST(NEW.result AS BLOB)),0)+COALESCE(length(CAST(NEW.context AS BLOB)),0)+COALESCE(length(CAST(NEW.source_key AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.request_id AS BLOB)),0)+COALESCE(length(CAST(OLD.from_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.to_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.kind AS BLOB)),0)+COALESCE(length(CAST(OLD.text AS BLOB)),0)+COALESCE(length(CAST(OLD.result AS BLOB)),0)+COALESCE(length(CAST(OLD.context AS BLOB)),0)+COALESCE(length(CAST(OLD.source_key AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.request_id AS BLOB)),0)+COALESCE(length(CAST(OLD.from_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.to_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.kind AS BLOB)),0)+COALESCE(length(CAST(OLD.text AS BLOB)),0)+COALESCE(length(CAST(OLD.result AS BLOB)),0)+COALESCE(length(CAST(OLD.context AS BLOB)),0)+COALESCE(length(CAST(OLD.source_key AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.request_id AS BLOB)),0)+COALESCE(length(CAST(NEW.from_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.to_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.kind AS BLOB)),0)+COALESCE(length(CAST(NEW.text AS BLOB)),0)+COALESCE(length(CAST(NEW.result AS BLOB)),0)+COALESCE(length(CAST(NEW.context AS BLOB)),0)+COALESCE(length(CAST(NEW.source_key AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.request_id AS BLOB)),0)+COALESCE(length(CAST(NEW.from_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.to_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.kind AS BLOB)),0)+COALESCE(length(CAST(NEW.text AS BLOB)),0)+COALESCE(length(CAST(NEW.result AS BLOB)),0)+COALESCE(length(CAST(NEW.context AS BLOB)),0)+COALESCE(length(CAST(NEW.source_key AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.request_id AS BLOB)),0)+COALESCE(length(CAST(OLD.from_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.to_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.kind AS BLOB)),0)+COALESCE(length(CAST(OLD.text AS BLOB)),0)+COALESCE(length(CAST(OLD.result AS BLOB)),0)+COALESCE(length(CAST(OLD.context AS BLOB)),0)+COALESCE(length(CAST(OLD.source_key AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.request_id AS BLOB)),0)+COALESCE(length(CAST(NEW.from_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.to_agent AS BLOB)),0)+COALESCE(length(CAST(NEW.kind AS BLOB)),0)+COALESCE(length(CAST(NEW.text AS BLOB)),0)+COALESCE(length(CAST(NEW.result AS BLOB)),0)+COALESCE(length(CAST(NEW.context AS BLOB)),0)+COALESCE(length(CAST(NEW.source_key AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.request_id AS BLOB)),0)+COALESCE(length(CAST(OLD.from_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.to_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.kind AS BLOB)),0)+COALESCE(length(CAST(OLD.text AS BLOB)),0)+COALESCE(length(CAST(OLD.result AS BLOB)),0)+COALESCE(length(CAST(OLD.context AS BLOB)),0)+COALESCE(length(CAST(OLD.source_key AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_conversation_messages_delete AFTER DELETE ON conversation_messages BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.request_id AS BLOB)),0)+COALESCE(length(CAST(OLD.from_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.to_agent AS BLOB)),0)+COALESCE(length(CAST(OLD.kind AS BLOB)),0)+COALESCE(length(CAST(OLD.text AS BLOB)),0)+COALESCE(length(CAST(OLD.result AS BLOB)),0)+COALESCE(length(CAST(OLD.context AS BLOB)),0)+COALESCE(length(CAST(OLD.source_key AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- conversation_receipts: text columns workspace_id, conversation_id, agent_id, consumer_id.
CREATE TRIGGER storage_conversation_receipts_insert AFTER INSERT ON conversation_receipts BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.consumer_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_conversation_receipts_update AFTER UPDATE ON conversation_receipts
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.consumer_id AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.consumer_id AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.consumer_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.consumer_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.consumer_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.consumer_id AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.conversation_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.consumer_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.consumer_id AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_conversation_receipts_delete AFTER DELETE ON conversation_receipts BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.conversation_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.consumer_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- agent_collaboration: text columns workspace_id, agent_id, settings.
CREATE TRIGGER storage_agent_collaboration_insert AFTER INSERT ON agent_collaboration BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.settings AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_agent_collaboration_update AFTER UPDATE ON agent_collaboration
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.settings AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.settings AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.settings AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.settings AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.settings AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.settings AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.settings AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.settings AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_agent_collaboration_delete AFTER DELETE ON agent_collaboration BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.settings AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- agent_onboarding: text columns workspace_id, agent_id, provider, surface, step.
CREATE TRIGGER storage_agent_onboarding_insert AFTER INSERT ON agent_onboarding BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.provider AS BLOB)),0)+COALESCE(length(CAST(NEW.surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.step AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_agent_onboarding_update AFTER UPDATE ON agent_onboarding
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.provider AS BLOB)),0)+COALESCE(length(CAST(NEW.surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.step AS BLOB)),0))))<>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.provider AS BLOB)),0)+COALESCE(length(CAST(OLD.surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.step AS BLOB)),0)))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.provider AS BLOB)),0)+COALESCE(length(CAST(OLD.surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.step AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.provider AS BLOB)),0)+COALESCE(length(CAST(NEW.surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.step AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.provider AS BLOB)),0)+COALESCE(length(CAST(NEW.surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.step AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.provider AS BLOB)),0)+COALESCE(length(CAST(OLD.surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.step AS BLOB)),0))))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.provider AS BLOB)),0)+COALESCE(length(CAST(NEW.surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.step AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.provider AS BLOB)),0)+COALESCE(length(CAST(OLD.surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.step AS BLOB)),0))))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_agent_onboarding_delete AFTER DELETE ON agent_onboarding BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.provider AS BLOB)),0)+COALESCE(length(CAST(OLD.surface AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.step AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- collaboration_background_runs: text columns workspace_id, agent_id, run_id, method, request_id.
CREATE TRIGGER storage_collaboration_background_runs_insert AFTER INSERT ON collaboration_background_runs BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.run_id AS BLOB)),0)+COALESCE(length(CAST(NEW.method AS BLOB)),0)+COALESCE(length(CAST(NEW.request_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_collaboration_background_runs_update AFTER UPDATE ON collaboration_background_runs
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.run_id AS BLOB)),0)+COALESCE(length(CAST(NEW.method AS BLOB)),0)+COALESCE(length(CAST(NEW.request_id AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.run_id AS BLOB)),0)+COALESCE(length(CAST(OLD.method AS BLOB)),0)+COALESCE(length(CAST(OLD.request_id AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.run_id AS BLOB)),0)+COALESCE(length(CAST(OLD.method AS BLOB)),0)+COALESCE(length(CAST(OLD.request_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.run_id AS BLOB)),0)+COALESCE(length(CAST(NEW.method AS BLOB)),0)+COALESCE(length(CAST(NEW.request_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.run_id AS BLOB)),0)+COALESCE(length(CAST(NEW.method AS BLOB)),0)+COALESCE(length(CAST(NEW.request_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.run_id AS BLOB)),0)+COALESCE(length(CAST(OLD.method AS BLOB)),0)+COALESCE(length(CAST(OLD.request_id AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.run_id AS BLOB)),0)+COALESCE(length(CAST(NEW.method AS BLOB)),0)+COALESCE(length(CAST(NEW.request_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.run_id AS BLOB)),0)+COALESCE(length(CAST(OLD.method AS BLOB)),0)+COALESCE(length(CAST(OLD.request_id AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_collaboration_background_runs_delete AFTER DELETE ON collaboration_background_runs BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.run_id AS BLOB)),0)+COALESCE(length(CAST(OLD.method AS BLOB)),0)+COALESCE(length(CAST(OLD.request_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- activation_configs: text columns workspace_id, agent_id, provider, endpoint, token_ciphertext.
CREATE TRIGGER storage_activation_configs_insert AFTER INSERT ON activation_configs BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.provider AS BLOB)),0)+COALESCE(length(CAST(NEW.endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.token_ciphertext AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_activation_configs_update AFTER UPDATE ON activation_configs
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.provider AS BLOB)),0)+COALESCE(length(CAST(NEW.endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.token_ciphertext AS BLOB)),0))))<>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.provider AS BLOB)),0)+COALESCE(length(CAST(OLD.endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.token_ciphertext AS BLOB)),0)))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.provider AS BLOB)),0)+COALESCE(length(CAST(OLD.endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.token_ciphertext AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.provider AS BLOB)),0)+COALESCE(length(CAST(NEW.endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.token_ciphertext AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.provider AS BLOB)),0)+COALESCE(length(CAST(NEW.endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.token_ciphertext AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.provider AS BLOB)),0)+COALESCE(length(CAST(OLD.endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.token_ciphertext AS BLOB)),0))))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.provider AS BLOB)),0)+COALESCE(length(CAST(NEW.endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.token_ciphertext AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.provider AS BLOB)),0)+COALESCE(length(CAST(OLD.endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.token_ciphertext AS BLOB)),0))))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_activation_configs_delete AFTER DELETE ON activation_configs BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.provider AS BLOB)),0)+COALESCE(length(CAST(OLD.endpoint AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.token_ciphertext AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- activation_dispatches: text columns id, workspace_id, job_id, agent_id, generation, status, error_code, provider_session_id, provider_session_url, reservation_nonce.
CREATE TRIGGER storage_activation_dispatches_insert AFTER INSERT ON activation_dispatches BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.reservation_nonce AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_activation_dispatches_update AFTER UPDATE ON activation_dispatches
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.reservation_nonce AS BLOB)),0))))<>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.reservation_nonce AS BLOB)),0)))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.reservation_nonce AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.reservation_nonce AS BLOB)),0))))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.reservation_nonce AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.reservation_nonce AS BLOB)),0))))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.id AS BLOB)),0)+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(NEW.reservation_nonce AS BLOB)),0))))>(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.reservation_nonce AS BLOB)),0))))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_activation_dispatches_delete AFTER DELETE ON activation_dispatches BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.id AS BLOB)),0)+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.generation AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.status AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.error_code AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.provider_session_id AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.provider_session_url AS BLOB)),0))+MAX(512,COALESCE(length(CAST(OLD.reservation_nonce AS BLOB)),0)))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- activation_launch_attempts: text columns dispatch_id, reservation_nonce, workspace_id, agent_id, job_id.
CREATE TRIGGER storage_activation_launch_attempts_insert AFTER INSERT ON activation_launch_attempts BEGIN
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
    >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
END;
CREATE TRIGGER storage_activation_launch_attempts_update AFTER UPDATE ON activation_launch_attempts
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)))<>(1024+2*(COALESCE(length(CAST(OLD.dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0))) BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  INSERT INTO workspace_storage_usage(workspace_id,accounted_bytes) VALUES(NEW.workspace_id,1024+2*(COALESCE(length(CAST(NEW.dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)))
    ON CONFLICT(workspace_id) DO UPDATE SET accounted_bytes=accounted_bytes+excluded.accounted_bytes;
  SELECT RAISE(ABORT,'storage_limit') WHERE (NEW.workspace_id IS NOT OLD.workspace_id OR (1024+2*(COALESCE(length(CAST(NEW.dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)))) AND
    (SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=NEW.workspace_id)
      >COALESCE((SELECT storage_limit_bytes FROM workspaces WHERE id=NEW.workspace_id),0);
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.workspace_id<>'default' AND (OLD.workspace_id='default' OR (1024+2*(COALESCE(length(CAST(NEW.dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(NEW.reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(NEW.workspace_id AS BLOB)),0)+COALESCE(length(CAST(NEW.agent_id AS BLOB)),0)+COALESCE(length(CAST(NEW.job_id AS BLOB)),0)))>(1024+2*(COALESCE(length(CAST(OLD.dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0)))) AND
    (SELECT COALESCE(SUM(accounted_bytes),0) FROM workspace_storage_usage WHERE workspace_id<>'default')>1610612736;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;
CREATE TRIGGER storage_activation_launch_attempts_delete AFTER DELETE ON activation_launch_attempts BEGIN
  UPDATE workspace_storage_usage SET accounted_bytes=accounted_bytes-(1024+2*(COALESCE(length(CAST(OLD.dispatch_id AS BLOB)),0)+MAX(512,COALESCE(length(CAST(OLD.reservation_nonce AS BLOB)),0))+COALESCE(length(CAST(OLD.workspace_id AS BLOB)),0)+COALESCE(length(CAST(OLD.agent_id AS BLOB)),0)+COALESCE(length(CAST(OLD.job_id AS BLOB)),0))) WHERE workspace_id=OLD.workspace_id;
  DELETE FROM workspace_storage_usage WHERE workspace_id=OLD.workspace_id AND accounted_bytes=0
    AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id);
END;

-- Stable consumers are counted across the connection, rather than separately in
-- every conversation. Existing legacy consumers are preserved if already >8;
-- they can advance, but a ninth/new identity cannot allocate another cursor.
CREATE INDEX conversation_receipts_consumers ON conversation_receipts(workspace_id,agent_id,consumer_id);
CREATE TRIGGER conversation_consumer_insert BEFORE INSERT ON conversation_receipts
WHEN NOT EXISTS(SELECT 1 FROM conversation_receipts WHERE workspace_id=NEW.workspace_id AND agent_id=NEW.agent_id AND consumer_id=NEW.consumer_id)
 AND (SELECT COUNT(DISTINCT consumer_id) FROM conversation_receipts WHERE workspace_id=NEW.workspace_id AND agent_id=NEW.agent_id)>=8
BEGIN SELECT RAISE(ABORT,'consumer_limit'); END;
CREATE TRIGGER conversation_consumer_update BEFORE UPDATE OF workspace_id,agent_id,consumer_id ON conversation_receipts
WHEN NOT EXISTS(SELECT 1 FROM conversation_receipts WHERE workspace_id=NEW.workspace_id AND agent_id=NEW.agent_id AND consumer_id=NEW.consumer_id)
 AND (SELECT COUNT(DISTINCT consumer_id) FROM conversation_receipts WHERE workspace_id=NEW.workspace_id AND agent_id=NEW.agent_id)>=8
BEGIN SELECT RAISE(ABORT,'consumer_limit'); END;
