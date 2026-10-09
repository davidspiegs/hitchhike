-- One fixed counter row per authenticated workspace plus one service row. Periods
-- roll over in place; request-controlled keys cannot create time-series rows.
CREATE TABLE resource_operation_budgets (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','workspace')),
  scope_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  day_used INTEGER NOT NULL CHECK (day_used >= 0),
  month_key TEXT NOT NULL,
  month_used INTEGER NOT NULL CHECK (month_used >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope_type,scope_id),
  CHECK (scope_type != 'global' OR scope_id = 'service')
);

-- Deleting a workspace releases its metadata, not its service-wide usage.
CREATE TRIGGER resource_budgets_delete_workspace AFTER DELETE ON workspaces BEGIN
  DELETE FROM resource_operation_budgets WHERE scope_type='workspace' AND scope_id=OLD.id;
END;
