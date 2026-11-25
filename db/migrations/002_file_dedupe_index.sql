-- Speeds up per-workspace content dedupe on upload (sha256 lookups).
CREATE INDEX IF NOT EXISTS kf_ws_sha_idx ON knowledge_files(workspace_id, sha256);
