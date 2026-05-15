ALTER TABLE desktop_devices ADD COLUMN IF NOT EXISTS pending_release_at TIMESTAMPTZ;
