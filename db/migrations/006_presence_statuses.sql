-- New runtime statuses: orchestrator "thinking" (planning) and "collaborating" (blocked on another agent).
ALTER TABLE agent_presence DROP CONSTRAINT agent_presence_status_check;
ALTER TABLE agent_presence ADD CONSTRAINT agent_presence_status_check
  CHECK (status IN ('idle','working','thinking','collaborating','waiting','meeting','error','paused'));
