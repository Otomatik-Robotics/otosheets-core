-- Which of the org's websites took the order (site host, stamped at checkout).
-- NULL = order predates multi-site attribution → treated as the primary site's.
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS site_host TEXT;
