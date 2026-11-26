import { beforeAll, describe, expect, it } from "vitest";
import { query, queryOne } from "@/lib/db";
import { ensureSystemAgents, updateWorkspaceAgent } from "@/lib/agents/store";
import { syncToolRegistry } from "@/lib/tools/registry";
import { handleChatMessage } from "@/lib/orchestrator/chat";
import { runTask } from "@/lib/orchestrator/engine";
import { getPresence, refreshPresence } from "@/lib/office/events";
import { getMeeting } from "@/lib/office/meetings";
import { getAgentDetail, getOfficeState } from "@/lib/office/state";
import { makeUser } from "./helpers";

beforeAll(async () => {
  await ensureSystemAgents(true);
  await syncToolRegistry(true);
});

const eventsFor = (taskId: string) =>
  query<{ agent: string; type: string; related: string | null; zone: string | null; meeting_id: string | null }>(
    `SELECT agent_slug AS agent, event_type AS type, related_agent AS related, zone, meeting_id FROM agent_activity_events WHERE task_id=$1 ORDER BY id`, [taskId],
  );

describe("Nexus Office — real activity integration", () => {
  it("A/B/C: assigning a task to باحث delegates, works, and returns a real result message to راشد", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "ar", text: "Search the knowledge base for supplier risks", targetAgent: "research" });
    expect(r.plan.steps).toHaveLength(1);
    expect(r.plan.steps[0].agent).toBe("research");

    // Orchestrator presence reflects the received task before execution.
    let presence = await getPresence(u.workspaceId);
    expect(presence.find((p) => p.agent === "orchestrator")!.status).toBe("working");

    // While the step is running, باحث is shown working at the research desk (derived from real step state).
    const step = await queryOne<{ id: string }>("SELECT id FROM task_steps WHERE task_id=$1", [r.taskId]);
    await query("UPDATE task_steps SET status='running' WHERE id=$1", [step!.id]);
    await refreshPresence(u.workspaceId);
    presence = await getPresence(u.workspaceId);
    const baheth = presence.find((p) => p.agent === "research")!;
    expect(baheth).toMatchObject({ status: "working", zone: "research", taskId: r.taskId });
    await query("UPDATE task_steps SET status='pending' WHERE id=$1", [step!.id]);

    expect(await runTask(r.taskId!)).toBe("completed");
    const ev = await eventsFor(r.taskId!);
    const types = ev.map((e) => `${e.agent}:${e.type}`);
    expect(types).toEqual(expect.arrayContaining([
      "orchestrator:task_received", "orchestrator:delegated", "research:step_started", "research:tool_used",
      "research:message_sent", "orchestrator:message_received", "research:step_completed", "orchestrator:task_completed",
    ]));
    expect(ev.find((e) => e.type === "delegated")).toMatchObject({ related: "research", zone: "research" });

    const msgs = await query<{ from_agent: string; to_agent: string; kind: string; content: string }>(
      "SELECT from_agent, to_agent, kind, content FROM agent_messages WHERE task_id=$1 ORDER BY created_at", [r.taskId],
    );
    expect(msgs.map((m) => `${m.from_agent}->${m.to_agent}:${m.kind}`)).toEqual(["orchestrator->research:delegation", "research->orchestrator:result"]);
    const output = await queryOne<{ output: string }>("SELECT output FROM task_steps WHERE id=$1", [step!.id]);
    expect(output!.output.startsWith(msgs[1].content.replace(/…$/, "").slice(0, 50))).toBe(true);

    // F: everyone is idle at their own desk afterwards
    presence = await getPresence(u.workspaceId);
    expect(presence.every((p) => p.status === "idle")).toBe(true);
    expect(presence.find((p) => p.agent === "research")!.zone).toBe("research");
  });

  it("D/E/F/G: a research → meeting → writing task runs a real meeting and persists transcript, decisions and action items", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Research three competitors and prepare a comparison report" });
    expect(r.plan.steps.map((s) => s.kind)).toEqual(["agent", "meeting", "agent"]);

    expect(await runTask(r.taskId!)).toBe("completed");
    const ev = await eventsFor(r.taskId!);
    const meetingStart = ev.find((e) => e.type === "meeting_started");
    expect(meetingStart).toBeTruthy();
    const meeting = (await getMeeting(u.workspaceId, meetingStart!.meeting_id!))!;
    expect(meeting.status).toBe("completed");
    expect(meeting.chair).toBe("orchestrator");
    expect(meeting.participants.sort()).toEqual(["documents", "orchestrator", "research"]);
    const statements = meeting.messages.filter((m) => m.kind === "statement");
    expect(statements).toHaveLength(4); // 2 participants × 2 rounds, each a real model call
    expect(new Set(statements.map((m) => m.agent))).toEqual(new Set(["research", "documents"]));
    expect(meeting.messages.at(-1)!.kind).toBe("summary");
    expect(meeting.decisions.length).toBeGreaterThan(0);
    expect(meeting.actionItems[0]).toMatchObject({ owner: "documents" });
    expect(meeting.agenda.length).toBeGreaterThan(0);
    expect(meeting.startedAt && meeting.completedAt).toBeTruthy();
    expect(ev.filter((e) => e.type === "meeting_message").length).toBe(5);
    expect(ev.some((e) => e.type === "meeting_ended")).toBe(true);

    // Invitations and hand-offs are real messages: research → documents (meeting input), meeting outcome → writing.
    const msgs = await query<{ from_agent: string; to_agent: string; kind: string }>("SELECT from_agent, to_agent, kind FROM agent_messages WHERE task_id=$1", [r.taskId]);
    const pairs = msgs.map((m) => `${m.from_agent}->${m.to_agent}:${m.kind}`);
    expect(pairs).toEqual(expect.arrayContaining([
      "orchestrator->research:delegation", "research->documents:handoff", "orchestrator->documents:meeting_invite",
      "orchestrator->research:meeting_invite", "orchestrator->writing:handoff", "writing->orchestrator:result",
    ]));

    // The writing step received the meeting outcome as its input.
    const writeStep = await queryOne<{ checkpoint: { messages: Array<{ content: unknown }> } }>("SELECT checkpoint FROM task_steps WHERE task_id=$1 AND step_key='write'", [r.taskId]);
    expect(JSON.stringify(writeStep!.checkpoint.messages[0].content)).toContain("Meeting outcome");

    // F: nobody is left in the meeting room
    const presence = await getPresence(u.workspaceId);
    expect(presence.filter((p) => p.status === "meeting")).toHaveLength(0);
    expect(presence.find((p) => p.agent === "documents")!.zone).toBe("documents");

    // G: history survives a fresh load
    const state = await getOfficeState(u.workspaceId);
    expect(state.meetings[0].id).toBe(meeting.id);
    expect(state.events.some((e) => e.type === "meeting_message")).toBe(true);
    expect(state.messages.length).toBeGreaterThanOrEqual(6);
    const detail = await getAgentDetail(u.workspaceId, "documents");
    expect(detail!.meetings.map((m) => m.id)).toContain(meeting.id);
    expect((detail!.metrics as { completed: number }).completed).toBeGreaterThanOrEqual(1);
  });

  it("shows waiting for approval and waiting for another agent, and paused agents", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Send a webhook to https://hooks.example.com/office" });
    expect(await runTask(r.taskId!)).toBe("waiting_approval");
    let presence = await getPresence(u.workspaceId);
    expect(presence.find((p) => p.agent === "operations")).toMatchObject({ status: "waiting", waitingFor: "approval" });

    const m = await handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "Research the market and write a report" });
    await refreshPresence(u.workspaceId);
    presence = await getPresence(u.workspaceId);
    expect(presence.find((p) => p.agent === "writing")).toMatchObject({ status: "waiting", waitingFor: expect.stringMatching(/research|marketing/) });
    expect(m.taskId).toBeTruthy();

    await updateWorkspaceAgent(u.workspaceId, "marketing", u.userId, { active: false });
    await query("UPDATE tasks SET status='cancelled' WHERE workspace_id=$1", [u.workspaceId]);
    await refreshPresence(u.workspaceId);
    presence = await getPresence(u.workspaceId);
    expect(presence.find((p) => p.agent === "marketing")!.status).toBe("paused");
  });

  it("rejects invalid meetings and direct assignment to unknown agents", async () => {
    const u = await makeUser();
    await expect(handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "x meeting", meetingParticipants: ["research"] })).rejects.toThrow(/2–4/);
    await expect(handleChatMessage({ workspaceId: u.workspaceId, userId: u.userId, locale: "en", text: "do it", targetAgent: "hacker" })).rejects.toThrow(/not available/);
  });

  it("keeps workspaces isolated", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const r = await handleChatMessage({ workspaceId: a.workspaceId, userId: a.userId, locale: "en", text: "Research three competitors and prepare a comparison report" });
    await runTask(r.taskId!);
    const sb = await getOfficeState(b.workspaceId);
    expect(sb.meetings).toHaveLength(0);
    expect(sb.events).toHaveLength(0);
    expect(sb.messages).toHaveLength(0);
  });
});
