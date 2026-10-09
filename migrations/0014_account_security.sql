-- Operator suspension is separate from an owner's ordinary pause and from
-- provider/invitation restrictions. No owner-facing setting writes these flags.
ALTER TABLE workspaces ADD COLUMN security_suspended INTEGER NOT NULL DEFAULT 0 CHECK(security_suspended IN (0,1));
ALTER TABLE workspaces ADD COLUMN identity_restricted INTEGER NOT NULL DEFAULT 0 CHECK(identity_restricted IN (0,1));
CREATE TABLE identity_security (
  identity_hash TEXT PRIMARY KEY,
  restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX users_workspace ON users(workspace_id);
CREATE INDEX users_identity_hash ON users(identity_hash);
CREATE INDEX oauth_clients_created ON oauth_clients(created_at);
CREATE INDEX oauth_requests_session ON oauth_requests(session_hash);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX oauth_grants_client ON oauth_grants(client_id);
CREATE INDEX oauth_codes_grant ON oauth_codes(grant_id);

-- An operator can suspend directly in D1. The same transaction revokes every
-- cached capability, including in-flight claims, without depending on another
-- browser request or webhook retry. Static keys are blocked by the workspace
-- restriction; restored owners retain their configured agent connections.
CREATE TRIGGER workspace_security_revoke AFTER UPDATE OF security_suspended,identity_restricted ON workspaces
WHEN (NEW.security_suspended=1 AND OLD.security_suspended=0)
  OR (NEW.identity_restricted=1 AND OLD.identity_restricted=0)
BEGIN
  UPDATE agents SET auth_generation=auth_generation+1 WHERE workspace_id=NEW.id;
  UPDATE claims SET revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE workspace_id=NEW.id AND revoked_at IS NULL;
  UPDATE oauth_grants SET revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE workspace_id=NEW.id AND revoked_at IS NULL;
  INSERT OR IGNORE INTO clerk_session_revocations(session_hash,created_at)
    SELECT s.token_hash,CAST(strftime('%s','now') AS INTEGER)*1000 FROM auth_sessions s
    JOIN users u ON u.id=s.user_id WHERE u.workspace_id=NEW.id AND s.provider='clerk';
  DELETE FROM oauth_requests WHERE session_hash IN (SELECT token_hash FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE workspace_id=NEW.id));
  DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE workspace_id=NEW.id);
  DELETE FROM pairing_codes WHERE workspace_id=NEW.id;
END;
