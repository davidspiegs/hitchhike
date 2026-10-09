-- Keep next_run_at as the stable occurrence/idempotency slot. next_attempt_at
-- controls retry eligibility and provides a bounded reservation after a crash.
ALTER TABLE schedules ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN attempt_token TEXT;
ALTER TABLE schedules ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN consecutive_permanent_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN last_error TEXT;
ALTER TABLE schedules ADD COLUMN disabled_reason TEXT;
UPDATE schedules SET next_attempt_at=next_run_at;
CREATE INDEX schedules_retry_due ON schedules (workspace_id,enabled,next_attempt_at,next_run_at);
