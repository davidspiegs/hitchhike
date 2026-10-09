-- Keep internal user IDs, workspaces, and MCP grants unchanged. External
-- identities are namespaced; matching email addresses never link accounts.
ALTER TABLE users ADD COLUMN identity_key TEXT;
ALTER TABLE users ADD COLUMN identity_hash TEXT;
CREATE UNIQUE INDEX users_identity_key ON users(identity_key);
UPDATE users SET identity_key=json_array(
  CASE WHEN google_sub LIKE 'dev:%' THEN 'dev' ELSE 'google' END,
  CASE WHEN google_sub LIKE 'dev:%' THEN 'local' ELSE 'https://accounts.google.com' END,
  google_sub
);
ALTER TABLE users ADD COLUMN identity_checked_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'google';
ALTER TABLE auth_sessions ADD COLUMN provider_session_id TEXT;
CREATE TABLE identity_tombstones (
  identity_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER prevent_deleted_identity_insert BEFORE INSERT ON users
WHEN NEW.identity_hash IS NOT NULL AND EXISTS(SELECT 1 FROM identity_tombstones WHERE identity_hash=NEW.identity_hash)
BEGIN SELECT RAISE(ABORT,'identity_deleted'); END;
CREATE TABLE clerk_session_revocations (
  session_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
-- Retry provider cleanup after local revocation. These are provider resource
-- identifiers, never access tokens; completed actions are deleted.
CREATE TABLE clerk_actions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('revoke_session','delete_user')),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL
);
CREATE INDEX clerk_actions_due ON clerk_actions(next_attempt_at);
CREATE TABLE account_deletions (
  user_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
