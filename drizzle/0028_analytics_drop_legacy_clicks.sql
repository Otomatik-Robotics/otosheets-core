-- One-off backfill: drop pre-deploy click rows so the heatmap only shows
-- pixel-accurate data. Early clicks were stored as a viewport FRACTION with no
-- captured page width (`pw IS NULL`); they place inaccurately against the
-- absolute-px renderer and can't be corrected retroactively. Runs once (recorded
-- in _migrations); deleting already-absent rows is a no-op, so re-runs are safe.
DELETE FROM analytics_events WHERE type = 'click' AND pw IS NULL;
