"use client";

import { Suspense } from "react";
import { Page } from "@/components/page";
import { LoadingBlock } from "@/components/ui";
import { AgentBuilder } from "@/components/agent-management/builder";

export default function NewAgentPage() {
  return <Page wide><Suspense fallback={<LoadingBlock rows={6} />}><AgentBuilder /></Suspense></Page>;
}
