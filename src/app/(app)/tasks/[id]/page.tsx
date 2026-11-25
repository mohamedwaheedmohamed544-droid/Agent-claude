"use client";

import { useParams } from "next/navigation";
import { Page } from "@/components/page";
import { TaskDetailView } from "@/components/tasks/task-detail-view";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Page wide>
      <TaskDetailView key={id} taskId={id} />
    </Page>
  );
}
