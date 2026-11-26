-- Nexus Office: persistent agent activity, agent-to-agent messages, real meetings and presence.
-- Movement/animation frames are NOT stored; only business events and meaningful state changes.

-- Character identities (global; seeded from src/lib/office/profiles.ts at runtime).
CREATE TABLE agent_profiles (
  slug        text PRIMARY KEY,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  title_ar    text NOT NULL,
  title_en    text NOT NULL,
  color       text NOT NULL,
  desk_zone   text NOT NULL,
  appearance  jsonb NOT NULL,
  voice       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- reserved for future TTS (voice id per agent)
  sort_order  int  NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE office_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Steps can be ordinary agent work or a real multi-agent meeting.
ALTER TABLE task_steps ADD COLUMN kind text NOT NULL DEFAULT 'agent' CHECK (kind IN ('agent','meeting'));
ALTER TABLE task_steps ADD COLUMN participants text[] NOT NULL DEFAULT '{}';

CREATE TABLE meetings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id       uuid REFERENCES tasks(id) ON DELETE CASCADE,
  step_id       uuid UNIQUE REFERENCES task_steps(id) ON DELETE CASCADE,
  objective     text NOT NULL,
  agenda        jsonb NOT NULL DEFAULT '[]'::jsonb,
  chair_slug    text NOT NULL DEFAULT 'orchestrator',
  status        text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed','cancelled')),
  summary       text,
  decisions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_items  jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meetings_ws_idx ON meetings(workspace_id, started_at DESC);

CREATE TABLE meeting_participants (
  meeting_id  uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  agent_slug  text NOT NULL,
  role        text NOT NULL DEFAULT 'participant' CHECK (role IN ('chair','participant')),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  left_at     timestamptz,
  PRIMARY KEY (meeting_id, agent_slug)
);

CREATE TABLE meeting_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_slug   text NOT NULL,
  round        int  NOT NULL,
  kind         text NOT NULL DEFAULT 'statement' CHECK (kind IN ('statement','summary')),
  content      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, agent_slug, round, kind)
);
CREATE INDEX meeting_messages_idx ON meeting_messages(meeting_id, created_at);

-- Real messages between agents (delegations, hand-offs of step outputs, results to the orchestrator).
CREATE TABLE agent_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id      uuid REFERENCES tasks(id) ON DELETE CASCADE,
  step_id      uuid REFERENCES task_steps(id) ON DELETE SET NULL,
  meeting_id   uuid REFERENCES meetings(id) ON DELETE SET NULL,
  from_agent   text NOT NULL,
  to_agent     text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('delegation','handoff','result','meeting_invite')),
  content      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_messages_ws_idx ON agent_messages(workspace_id, created_at DESC);
CREATE INDEX agent_messages_agent_idx ON agent_messages(workspace_id, from_agent, to_agent);

-- Append-only business event stream that drives the live office (SSE cursor = id).
CREATE TABLE agent_activity_events (
  id            bigserial PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_slug    text NOT NULL,
  event_type    text NOT NULL,
  task_id       uuid REFERENCES tasks(id) ON DELETE SET NULL,
  step_id       uuid REFERENCES task_steps(id) ON DELETE SET NULL,
  meeting_id    uuid REFERENCES meetings(id) ON DELETE SET NULL,
  related_agent text,
  zone          text,
  summary       text NOT NULL DEFAULT '',
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_ws_id_idx ON agent_activity_events(workspace_id, id);
CREATE INDEX activity_agent_idx ON agent_activity_events(workspace_id, agent_slug, id DESC);

-- Current logical location + operational/animation state per agent (agent_locations and
-- agent_animation_states in one row). Recomputed from task/meeting state on every business event.
CREATE TABLE agent_presence (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_slug   text NOT NULL,
  status       text NOT NULL CHECK (status IN ('idle','working','waiting','meeting','error','paused')),
  zone         text NOT NULL,
  activity     text,
  task_id      uuid REFERENCES tasks(id) ON DELETE SET NULL,
  step_id      uuid REFERENCES task_steps(id) ON DELETE SET NULL,
  meeting_id   uuid REFERENCES meetings(id) ON DELETE SET NULL,
  waiting_for  text,
  since        timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, agent_slug)
);
