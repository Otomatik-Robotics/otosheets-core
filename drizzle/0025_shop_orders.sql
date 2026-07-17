-- Commerce (shop orders) — migrated from DynamoDB expense-app-orders (PK orgId,
-- SK ord-{stripeSessionId}). Additive + idempotent per the expand-contract rule.
CREATE TABLE IF NOT EXISTS shop_orders (
    org_id TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    order_number BIGINT NOT NULL,
    business_profile_id TEXT,
    status TEXT NOT NULL,
    buyer JSONB NOT NULL,
    shipping_address JSONB,
    shipping_option JSONB,
    lines JSONB NOT NULL,
    subtotal_cents BIGINT NOT NULL DEFAULT 0,
    shipping_cents BIGINT NOT NULL DEFAULT 0,
    tax_cents BIGINT NOT NULL DEFAULT 0,
    total_cents BIGINT NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'AUD',
    stripe_session_id TEXT NOT NULL,
    stripe_payment_intent_id TEXT,
    linked_invoice_id TEXT,
    fulfilment JSONB,
    refund JSONB,
    receipt_sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (org_id, order_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shop_orders_org_created_idx ON shop_orders (org_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shop_orders_org_status_idx ON shop_orders (org_id, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS shop_order_counters (
    org_id TEXT PRIMARY KEY REFERENCES orgs(org_id) ON DELETE CASCADE,
    seq BIGINT NOT NULL DEFAULT 0
);
