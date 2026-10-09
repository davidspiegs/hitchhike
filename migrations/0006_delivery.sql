-- Wake-up bodies and credential headers are never copied into this outbox.
-- Each queued generation is delivered at least once; receivers may deduplicate
-- successful requests using the stable X-Relay-Delivery-Id header.
CREATE TABLE wake_deliveries (
  workspace_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','delivered','failed','canceled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_status INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id,job_id,agent_id,generation)
);
CREATE INDEX wake_deliveries_due ON wake_deliveries (workspace_id,status,next_attempt_at);
CREATE INDEX wake_deliveries_leases ON wake_deliveries (workspace_id,status,lease_expires_at);
