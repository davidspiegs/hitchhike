-- Pairing codes carry no authority until redeemed and expire after ten minutes.
CREATE TABLE pairing_codes (
  code_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  auth_generation INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER
);
CREATE INDEX pairing_workspace ON pairing_codes(workspace_id, agent_id);
CREATE INDEX pairing_expiry ON pairing_codes(expires_at);
