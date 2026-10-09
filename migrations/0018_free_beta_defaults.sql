-- Apply the approved generous free allowance only to existing standard tenants.
-- Explicit custom or suspended-account policies and the legacy self-hosted
-- default are preserved. New hosted users receive these values in auth.ts.
UPDATE workspaces SET daily_job_limit=50 WHERE id<>'default' AND daily_job_limit=10;
UPDATE workspaces SET monthly_job_limit=500 WHERE id<>'default' AND monthly_job_limit=100;
