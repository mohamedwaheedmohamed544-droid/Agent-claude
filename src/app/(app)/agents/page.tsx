"use client";

import { Suspense } from "react";
import { Page } from "@/components/page";
import { LoadingBlock } from "@/components/ui";
import { AgentManagement } from "@/components/agent-management/agent-management";

export default function AgentsPage() {
  return <Page wide><Suspense fallback={<LoadingBlock rows={4} />}><AgentManagement /></Suspense></Page>;
}
