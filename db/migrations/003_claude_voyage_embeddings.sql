-- Switch the AI provider from OpenAI to Anthropic Claude. Embeddings now come from Voyage AI
-- (optional; 1024 dimensions). Existing 1536-d vectors are incompatible and are discarded:
-- documents keep their chunks (keyword search still works) and can be re-embedded with "Reprocess".
DROP INDEX IF EXISTS embeddings_hnsw_idx;
DROP INDEX IF EXISTS memory_hnsw_idx;
DELETE FROM embeddings;
UPDATE memory_items SET embedding = NULL, embedding_model = NULL WHERE embedding IS NOT NULL;
ALTER TABLE embeddings ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE memory_items ALTER COLUMN embedding TYPE vector(1024);
CREATE INDEX embeddings_hnsw_idx ON embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memory_hnsw_idx ON memory_items USING hnsw (embedding vector_cosine_ops);
