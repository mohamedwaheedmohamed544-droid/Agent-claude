-- Dynamic, database-driven workforce: agents are per-workspace configuration, never code.
-- Additive migration: existing agents/agent_versions rows are kept and extended; history references
-- agents by slug, which stays stable (slugs are never reused; deletion is a soft tombstone).

-- ───────── Departments & office structure ─────────
CREATE TABLE departments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key              text NOT NULL,
  name             text NOT NULL,
  name_ar          text NOT NULL,
  color            text NOT NULL DEFAULT '#6366f1',
  kind             text NOT NULL DEFAULT 'department' CHECK (kind IN ('executive','department')),
  manager_slug     text,
  meeting_room_key text,
  sort             int  NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

-- Extra zones (meeting rooms, lounges, custom work zones). Department areas are derived from departments.
CREATE TABLE office_zones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key          text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('meeting_room','lounge','zone')),
  name         text NOT NULL,
  name_ar      text NOT NULL,
  floor        int  NOT NULL DEFAULT 0,
  seats        int  NOT NULL DEFAULT 8,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

CREATE TABLE office_workstations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  idx           int  NOT NULL,
  agent_id      uuid UNIQUE,                       -- FK added below (agents defined earlier)
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, idx)
);
CREATE INDEX workstations_ws_idx ON office_workstations(workspace_id);

-- ───────── Agents: identity, lifecycle, office placement ─────────
ALTER TABLE agents ADD COLUMN role_title      text NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN role_title_ar   text NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN personality     text NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN lifecycle       text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('draft','active','inactive','archived'));
ALTER TABLE agents ADD COLUMN is_orchestrator boolean NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN department_id   uuid REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE agents ADD COLUMN supervisor_slug text;
ALTER TABLE agents ADD COLUMN office          jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agents ADD COLUMN template_key    text;
ALTER TABLE agents ADD COLUMN created_by      uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE agents ADD COLUMN archived_at     timestamptz;
ALTER TABLE agents ADD COLUMN deleted_at      timestamptz;
CREATE INDEX agents_ws_lifecycle_idx ON agents(workspace_id, lifecycle) WHERE deleted_at IS NULL;
ALTER TABLE office_workstations ADD CONSTRAINT workstations_agent_fk FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;

-- Full configuration snapshot per immutable version (AgentDefinitionInput). Legacy columns
-- (system_prompt, allowed_tools, model_tier, model_override) stay populated for compatibility.
ALTER TABLE agent_versions ADD COLUMN config      jsonb;
ALTER TABLE agent_versions ADD COLUMN change_note text;

-- ───────── Skills registry ─────────
CREATE TABLE skills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid REFERENCES workspaces(id) ON DELETE CASCADE,   -- NULL = built-in
  key            text NOT NULL,
  name           text NOT NULL,
  name_ar        text NOT NULL,
  description    text NOT NULL,
  category       text NOT NULL DEFAULT 'general',
  instructions   text NOT NULL,
  required_tools text[] NOT NULL DEFAULT '{}',
  depends_on     text[] NOT NULL DEFAULT '{}',
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX skills_key_uniq ON skills (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- Current skill assignments (also snapshotted in agent_versions.config).
CREATE TABLE agent_skills (
  agent_id   uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_key  text NOT NULL,
  mandatory  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, skill_key)
);

-- Current relationships (supervisor lives on agents.supervisor_slug).
CREATE TABLE agent_relationships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_slug   text NOT NULL,
  related_slug text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('delegates_to','collaborates_with')),
  PRIMARY KEY (workspace_id, agent_slug, related_slug, kind),
  CHECK (agent_slug <> related_slug)
);

-- ───────── Templates ─────────
CREATE TABLE agent_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,     -- NULL = built-in
  key          text NOT NULL,
  name         text NOT NULL,
  name_ar      text NOT NULL,
  description  text NOT NULL DEFAULT '',
  category     text NOT NULL DEFAULT 'general',
  config       jsonb NOT NULL,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX templates_key_uniq ON agent_templates (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- ───────── Runtime sessions (one per agent execution: step or meeting contribution) ─────────
CREATE TABLE agent_runtime_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_slug    text NOT NULL,
  agent_version int  NOT NULL,
  task_id       uuid REFERENCES tasks(id) ON DELETE SET NULL,
  step_id       uuid REFERENCES task_steps(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','interrupted')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);
CREATE INDEX runtime_sessions_agent_idx ON agent_runtime_sessions(workspace_id, agent_slug, started_at DESC);

-- ───────── Private agent memory ─────────
ALTER TABLE memory_items ADD COLUMN agent_slug text;
ALTER TABLE memory_items DROP CONSTRAINT memory_items_scope_check;
ALTER TABLE memory_items ADD CONSTRAINT memory_items_scope_check CHECK (scope IN ('user','workspace','task','agent'));

-- Meetings take place in a specific room.
ALTER TABLE meetings ADD COLUMN room_key text NOT NULL DEFAULT 'meeting_room';

-- Workspaces are seeded with the starter workforce once (from data, see src/lib/agents/catalog.ts).
ALTER TABLE workspaces ADD COLUMN agents_seeded_at timestamptz;
