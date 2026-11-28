-- 007: Intelligent company onboarding → Company Operating Profile → Workforce Blueprint.
--
-- Additive only: the previous application version keeps working against this schema.
-- Manual rollback (only if this feature must be removed entirely):
--   DROP TABLE IF EXISTS workforce_blueprints;
--   DROP TABLE IF EXISTS company_profiles;
--   ALTER TABLE workspaces DROP COLUMN IF EXISTS onboarding_status;

ALTER TABLE workspaces ADD COLUMN onboarding_status text NOT NULL DEFAULT 'not_started'
  CHECK (onboarding_status IN ('not_started','in_progress','proposed','active','skipped'));

-- One onboarding questionnaire per workspace. `answers` is exactly what the customer entered;
-- `profile` is the derived Company Operating Profile (recomputed whenever answers change).
CREATE TABLE company_profiles (
  workspace_id  uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile       jsonb,
  current_step  text NOT NULL DEFAULT 'identity',
  updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

-- Every proposal is an immutable-by-version record. Customer edits update the proposed row and its hash;
-- approval binds to the hash the customer reviewed; application records exactly what was generated.
CREATE TABLE workforce_blueprints (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version           int NOT NULL,
  status            text NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','approved','applying','applied','failed','superseded','rejected')),
  engine            text NOT NULL,
  profile           jsonb NOT NULL,
  blueprint         jsonb NOT NULL,
  blueprint_hash    text NOT NULL,
  edits             jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision_note     text,
  decision_note     text,
  generation_report jsonb,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  applied_at        timestamptz,
  UNIQUE (workspace_id, version)
);
CREATE INDEX blueprints_ws_idx ON workforce_blueprints(workspace_id, version DESC);
