import { beforeAll, describe, expect, it } from "vitest";
import { queryOne } from "@/lib/db";
import { ensureSystemAgents } from "@/lib/agents/store";
import { syncToolRegistry } from "@/lib/tools/registry";
import { handleChatMessage } from "@/lib/orchestrator/chat";
import { runTask } from "@/lib/orchestrator/engine";
import { listMeetings, getMeeting } from "@/lib/office/meetings";
import { makeUser } from "./helpers";

beforeAll(async () => {
  await ensureSystemAgents(true);
  await syncToolRegistry(true);
});

describe("Convened meetings (office 'Convene a meeting' / 'Invite to meeting')", () => {
  it("runs to completion with transcript, decisions and action items", async () => {
    const u = await makeUser();
    const r = await handleChatMessage({
      workspaceId: u.workspaceId, userId: u.userId, locale: "ar",
      text: "Agree the Q3 marketing priorities and who owns each", meetingParticipants: ["marketing", "analytics"],
    });
    const outcome = await runTask(r.taskId!);
    const step = await queryOne<{ status: string; error: unknown }>("SELECT status, error FROM task_steps WHERE task_id=$1", [r.taskId]);
    expect({ outcome, step }).toMatchObject({ outcome: "completed", step: { status: "completed" } });
    const [m] = await listMeetings(u.workspaceId);
    const detail = (await getMeeting(u.workspaceId, m.id))!;
    expect(detail.status).toBe("completed");
    expect(detail.messages.filter((x) => x.kind === "statement")).toHaveLength(4);
  });
});
