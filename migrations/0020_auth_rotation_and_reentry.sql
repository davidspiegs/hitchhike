-- Each issued capability retains the permissions it actually received. NULL
-- preserves existing grants for tokens created before this additive migration.
ALTER TABLE oauth_tokens ADD COLUMN scope TEXT;
-- A unique redemption marker ties a consumed source to its token pair inside
-- one D1 transaction, including concurrent exchanges in the same millisecond.
ALTER TABLE oauth_tokens ADD COLUMN redemption_id TEXT;
ALTER TABLE oauth_codes ADD COLUMN redemption_id TEXT;

-- Hosted Google/dev deletion must not mint fresh workspace quotas immediately.
-- Store only a namespaced identity hash and expiry, never the deleted profile.
-- Clerk keeps its existing permanent identity tombstone instead.
CREATE TABLE identity_signup_cooldowns (
  identity_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX identity_signup_cooldowns_expiry ON identity_signup_cooldowns(expires_at);
CREATE TRIGGER prevent_cooling_identity_insert BEFORE INSERT ON users
WHEN NEW.identity_hash IS NOT NULL AND EXISTS(
  SELECT 1 FROM identity_signup_cooldowns WHERE identity_hash=NEW.identity_hash
    AND expires_at>NEW.created_at)
BEGIN SELECT RAISE(ABORT,'identity_signup_cooldown'); END;
