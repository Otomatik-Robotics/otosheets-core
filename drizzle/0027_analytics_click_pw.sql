-- Click heatmap accuracy: store the page width the click was captured at so the
-- dashboard renders the page AT that width and places clicks by absolute px
-- (a width-normalised fraction drifts because content is max-width centred).
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS pw INTEGER;
