-- Directory installs register a client per connection (DCR) or present an
-- HTTPS client ID metadata document (CIMD). Additive: an older Worker ignores
-- both columns and keeps its previous total-count guard.
--
-- claimed_at: first authorization by a signed-in owner. Only unclaimed,
-- anonymous registrations count toward the registration allowance.
-- metadata_expires_at: set only for CIMD rows, which cache a fetched document
-- and are keyed by its URL. NULL marks a dynamically registered client.
ALTER TABLE oauth_clients ADD COLUMN claimed_at INTEGER;
ALTER TABLE oauth_clients ADD COLUMN metadata_expires_at INTEGER;
-- Existing registrations keep their previous 30-day retention.
UPDATE oauth_clients SET claimed_at=created_at;
CREATE INDEX oauth_clients_unclaimed ON oauth_clients(created_at) WHERE claimed_at IS NULL;
CREATE INDEX oauth_clients_metadata ON oauth_clients(metadata_expires_at) WHERE metadata_expires_at IS NOT NULL;
