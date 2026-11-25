-- Nexus AI — initial schema
-- Requires PostgreSQL 15+ (Neon). pgvector is required for semantic search.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ───────────────────────── Identity & tenancy ─────────────────────────

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  name            text NOT NULL,
  password_hash   text NOT NULL,
  locale          text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ar')),
  theme           text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  is_platform_admin boolean NOT NULL DEFAULT false,
  last_workspace_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  owner_id    uuid NOT NULL REFERENCES users(id),
  -- permissions & autonomy settings; see src/lib/settings.ts for the shape
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD CONSTRAINT users_last_ws_fk
  FOREIGN KEY (last_workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members(user_id);

-- ───────────────────────── Agents ─────────────────────────

CREATE TABLE agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL = built-in system agent
  slug           text NOT NULL,
  name           text NOT NULL,
  name_ar        text,
  description    text NOT NULL,
  description_ar text,
  icon           text NOT NULL DEFAULT 'bot',
  color          text NOT NULL DEFAULT '#6366f1',
  capabilities   text[] NOT NULL DEFAULT '{}',
  is_system      boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  current_version_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agents_slug_uniq ON agents (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

CREATE TABLE agent_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version        int  NOT NULL,
  system_prompt  text NOT NULL,
  allowed_tools  text[] NOT NULL DEFAULT '{}',
  model_tier     text NOT NULL DEFAULT 'standard' CHECK (model_tier IN ('fast','standard','advanced')),
  model_override text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);
ALTER TABLE agents ADD CONSTRAINT agents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES agent_versions(id) ON DELETE SET NULL;

-- ───────────────────────── Conversations ─────────────────────────

CREATE TABLE conversations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT 'New conversation',
  archived     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_ws_user_idx ON conversations(workspace_id, user_id, updated_at DESC);

-- ───────────────────────── Tasks ─────────────────────────

CREATE TABLE tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  parent_task_id  uuid REFERENCES tasks(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  title           text NOT NULL,
  objective       text NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','planned','running','waiting_approval','paused','completed','failed','cancelled')),
  mode            text NOT NULL DEFAULT 'single' CHECK (mode IN ('single','multi')),
  plan            jsonb,
  result          text,
  summary         text,
  error           jsonb,
  cancel_requested boolean NOT NULL DEFAULT false,
  pause_requested  boolean NOT NULL DEFAULT false,
  lock_owner      text,
  locked_until    timestamptz,
  run_count       int NOT NULL DEFAULT 0,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_ws_status_idx ON tasks(workspace_id, status, updated_at DESC);
CREATE INDEX tasks_conversation_idx ON tasks(conversation_id);
CREATE INDEX tasks_resumable_idx ON tasks(status, locked_until) WHERE status IN ('planned','running');

CREATE TABLE task_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  step_key        text NOT NULL,
  position        int  NOT NULL,
  agent_slug      text NOT NULL,
  title           text NOT NULL,
  input           text NOT NULL,
  expected_output text,
  condition       text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','waiting_approval','completed','failed','skipped','cancelled')),
  output          text,
  output_meta     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error           jsonb,
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 3,
  next_attempt_at timestamptz,
  -- persisted tool-loop transcript so a step can resume after approval / restart
  checkpoint      jsonb,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, step_key)
);
CREATE INDEX task_steps_task_idx ON task_steps(task_id, position);

CREATE TABLE task_dependencies (
  step_id            uuid NOT NULL REFERENCES task_steps(id) ON DELETE CASCADE,
  depends_on_step_id uuid NOT NULL REFERENCES task_steps(id) ON DELETE CASCADE,
  PRIMARY KEY (step_id, depends_on_step_id),
  CHECK (step_id <> depends_on_step_id)
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  role            text NOT NULL CHECK (role IN ('user','assistant','system')),
  content         text NOT NULL,
  agent_slug      text,
  task_id         uuid REFERENCES tasks(id) ON DELETE SET NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);

-- ───────────────────────── Tools & approvals ─────────────────────────

CREATE TABLE tool_registry (
  name                 text PRIMARY KEY,
  description          text NOT NULL,
  risk_level           int  NOT NULL CHECK (risk_level BETWEEN 1 AND 4),
  category             text NOT NULL,
  input_schema         jsonb NOT NULL,
  output_schema        jsonb,
  required_permissions text[] NOT NULL DEFAULT '{}',
  integration_provider text,
  enabled              boolean NOT NULL DEFAULT true,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id          uuid REFERENCES tasks(id) ON DELETE CASCADE,
  step_id          uuid REFERENCES task_steps(id) ON DELETE CASCADE,
  tool_name        text NOT NULL REFERENCES tool_registry(name),
  risk_level       int  NOT NULL CHECK (risk_level BETWEEN 1 AND 4),
  agent_slug       text,
  summary          text NOT NULL,
  destination      text,
  params           jsonb NOT NULL,
  -- sha256 of canonical(tool_name, params). Approval is valid ONLY for this exact hash.
  params_hash      text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','expired','executed','superseded')),
  decided_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at       timestamptz,
  decision_note    text,
  executed_at      timestamptz,
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_ws_status_idx ON approvals(workspace_id, status, created_at DESC);
CREATE INDEX approvals_step_idx ON approvals(step_id);

CREATE TABLE tool_executions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE CASCADE,
  step_id         uuid REFERENCES task_steps(id) ON DELETE CASCADE,
  tool_name       text NOT NULL,
  agent_slug      text,
  risk_level      int NOT NULL,
  input           jsonb NOT NULL,
  output          jsonb,
  status          text NOT NULL CHECK (status IN ('running','succeeded','failed','blocked','awaiting_approval')),
  approval_id     uuid REFERENCES approvals(id) ON DELETE SET NULL,
  idempotency_key text,
  error           text,
  duration_ms     int,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_exec_ws_idx ON tool_executions(workspace_id, created_at DESC);
CREATE INDEX tool_exec_task_idx ON tool_executions(task_id);
-- external side effects run at most once per idempotency key
CREATE UNIQUE INDEX tool_exec_idem_uniq ON tool_executions(idempotency_key) WHERE idempotency_key IS NOT NULL AND status = 'succeeded';

-- ───────────────────────── Audit & usage ─────────────────────────

CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type   text NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor        text,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_ws_idx ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX audit_action_idx ON audit_logs(action);

CREATE TABLE usage_records (
  id                bigserial PRIMARY KEY,
  workspace_id      uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  task_id           uuid REFERENCES tasks(id) ON DELETE SET NULL,
  agent_slug        text,
  model             text NOT NULL,
  purpose           text NOT NULL,
  prompt_tokens     int NOT NULL DEFAULT 0,
  completion_tokens int NOT NULL DEFAULT 0,
  cost_usd          numeric(12,6) NOT NULL DEFAULT 0,
  latency_ms        int,
  success           boolean NOT NULL DEFAULT true,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_ws_idx ON usage_records(workspace_id, created_at DESC);

CREATE TABLE api_request_logs (
  id           bigserial PRIMARY KEY,
  workspace_id uuid,
  user_id      uuid,
  method       text NOT NULL,
  route        text NOT NULL,
  status       int  NOT NULL,
  duration_ms  int  NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_logs_created_idx ON api_request_logs(created_at DESC);

CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        int NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- ───────────────────────── Integrations ─────────────────────────

CREATE TABLE integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider         text NOT NULL,
  status           text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','error','pending')),
  account_label    text,
  scopes           text[] NOT NULL DEFAULT '{}',
  -- AES-256-GCM encrypted JSON token bundle; never returned by any API
  encrypted_tokens text,
  token_expires_at timestamptz,
  connected_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE oauth_states (
  state        text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     text NOT NULL,
  code_verifier text,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Knowledge ─────────────────────────

CREATE TABLE knowledge_bases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kb_ws_idx ON knowledge_bases(workspace_id);

CREATE TABLE knowledge_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid REFERENCES knowledge_bases(id) ON DELETE SET NULL,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  filename          text NOT NULL,
  mime_type         text NOT NULL,
  size_bytes        int  NOT NULL,
  sha256            text NOT NULL,
  content           bytea NOT NULL,
  extracted_text    text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','failed')),
  error             text,
  chunk_count       int NOT NULL DEFAULT 0,
  uploaded_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kf_ws_idx ON knowledge_files(workspace_id, created_at DESC);
CREATE INDEX kf_kb_idx ON knowledge_files(knowledge_base_id);

CREATE TABLE document_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id      uuid NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
  chunk_index  int  NOT NULL,
  content      text NOT NULL,
  token_count  int  NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, chunk_index)
);
CREATE INDEX chunks_ws_idx ON document_chunks(workspace_id);
CREATE INDEX chunks_tsv_idx ON document_chunks USING gin(tsv);

CREATE TABLE embeddings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chunk_id     uuid NOT NULL UNIQUE REFERENCES document_chunks(id) ON DELETE CASCADE,
  model        text NOT NULL,
  embedding    vector(1536) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX embeddings_ws_idx ON embeddings(workspace_id);
CREATE INDEX embeddings_hnsw_idx ON embeddings USING hnsw (embedding vector_cosine_ops);

-- ───────────────────────── Memory ─────────────────────────

CREATE TABLE memory_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,   -- set for scope='user'
  task_id      uuid REFERENCES tasks(id) ON DELETE CASCADE,   -- set for scope='task'
  scope        text NOT NULL CHECK (scope IN ('user','workspace','task')),
  kind         text NOT NULL DEFAULT 'fact'
               CHECK (kind IN ('preference','fact','decision','context','workflow','note')),
  content      text NOT NULL,
  source       text NOT NULL DEFAULT 'user' CHECK (source IN ('user','agent','system')),
  -- agent-proposed memories are inert until a user approves them
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','proposed','archived')),
  importance   real NOT NULL DEFAULT 0.5,
  embedding    vector(1536),
  embedding_model text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_ws_scope_idx ON memory_items(workspace_id, scope, status);
CREATE INDEX memory_hnsw_idx ON memory_items USING hnsw (embedding vector_cosine_ops);

-- ───────────────────────── Deliverables ─────────────────────────

CREATE TABLE generated_artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE SET NULL,
  step_id         uuid REFERENCES task_steps(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('document','spreadsheet','email_draft','report','presentation_outline','other')),
  title           text NOT NULL,
  format          text NOT NULL CHECK (format IN ('markdown','docx','xlsx','json','text')),
  mime_type       text NOT NULL,
  content_text    text,
  content_bytes   bytea,
  size_bytes      int NOT NULL DEFAULT 0,
  agent_slug      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_ws_idx ON generated_artifacts(workspace_id, created_at DESC);
CREATE INDEX artifacts_task_idx ON generated_artifacts(task_id);

-- Operations agent's internal work items (Level 2: internal, non-external)
CREATE TABLE work_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id      uuid REFERENCES tasks(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text,
  status       text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','blocked')),
  priority     text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  due_date     date,
  assignee     text,
  created_by_agent text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_items_ws_idx ON work_items(workspace_id, status);
