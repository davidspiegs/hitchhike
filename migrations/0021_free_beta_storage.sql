-- Give standard hosted workspaces room for the 500-request monthly allowance.
-- Preserve custom caps and the legacy self-hosted default. The shared 1.5 GiB
-- accounted-storage cap is unchanged and remains enforced by migration 0017.
UPDATE workspaces SET storage_limit_bytes=33554432
WHERE id<>'default' AND storage_limit_bytes=10485760;
