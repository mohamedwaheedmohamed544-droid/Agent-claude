// Tests run against a dedicated database with the deterministic mock LLM. Never point this at production.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/nexus_test";
process.env.NEXUS_LLM_PROVIDER = "mock";
process.env.NEXUS_DISABLE_KICK = "1";
process.env.NEXUS_ENCRYPTION_KEY = process.env.NEXUS_ENCRYPTION_KEY ?? "test-only-encryption-key-not-for-production";
process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "mock-model";
