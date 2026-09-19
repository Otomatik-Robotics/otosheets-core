-- Inbound email left the product on 2026-09-19 (no forwarding, no Gmail or
-- Outlook inbox sync). The connection blob users carried for it is dead
-- data; drop it rather than leave stale OAuth material on every row.
ALTER TABLE users DROP COLUMN IF EXISTS email_connections;
