CREATE TABLE IF NOT EXISTS notifications (
    user_id text NOT NULL,
    notification_id text NOT NULL,
    record jsonb NOT NULL,
    read boolean,
    ttl bigint,
    PRIMARY KEY (user_id, notification_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_expiry_idx ON notifications (ttl);
