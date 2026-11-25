"use client";

import { ListChecks } from "lucide-react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { useApp } from "@/components/providers";
import { TaskList } from "@/components/tasks/task-list";

export default function TasksPage() {
  const { t } = useApp();
  return (
    <Page wide>
      <PageHeader icon={<ListChecks className="size-5" />} title={t("nav.tasks")} description={t("tasks.description")} />
      <TaskList />
    </Page>
  );
}
