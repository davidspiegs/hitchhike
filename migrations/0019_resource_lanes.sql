-- Separate fixed allowances prevent anonymous or agent work from consuming the
-- owner's control/recovery allowance or the service's maintenance allowance.
-- These are bounded operation counters, not a dollar-denominated billing cap.
CREATE TABLE resource_lane_budgets (
  lane TEXT NOT NULL CHECK (lane IN ('anonymous','owner','maintenance')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','workspace')),
  scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 200),
  day_key TEXT NOT NULL,
  day_used INTEGER NOT NULL CHECK (day_used >= 0),
  month_key TEXT NOT NULL,
  month_used INTEGER NOT NULL CHECK (month_used >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (lane,scope_type,scope_id),
  CHECK (scope_type != 'global' OR scope_id = 'service'),
  CHECK (scope_type != 'workspace' OR lane = 'owner')
);

-- At most one additional owner-control row per workspace. Global admissions
-- survive workspace deletion so account recreation cannot refund the service.
CREATE TRIGGER resource_lanes_delete_workspace AFTER DELETE ON workspaces BEGIN
  DELETE FROM resource_lane_budgets WHERE scope_type='workspace' AND scope_id=OLD.id;
END;
