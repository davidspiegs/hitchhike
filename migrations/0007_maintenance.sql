-- Fair, bounded hosted cron work. Idle tenants incur no per-tenant maintenance
-- calls. Attempt timestamps keep failing schedules from starving their peers.
ALTER TABLE workspaces ADD COLUMN last_maintenance_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN last_attempt_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX workspaces_maintenance_order ON workspaces (last_maintenance_at,id);
CREATE INDEX schedules_attempt_order ON schedules (workspace_id,enabled,last_attempt_at,next_run_at,id);
CREATE INDEX jobs_due_lease ON jobs (workspace_id,lease_expires_at) WHERE status='claimed';
CREATE INDEX jobs_due_expiry ON jobs (workspace_id,expires_at)
  WHERE status NOT IN ('completed','failed','canceled','expired');
