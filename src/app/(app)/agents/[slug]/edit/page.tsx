"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { Page } from "@/components/page";
import { LoadingBlock } from "@/components/ui";
import { AgentBuilder } from "@/components/agent-management/builder";

export default function EditAgentPage() {
  const { slug } = useParams<{ slug: string }>();
  return <Page wide><Suspense fallback={<LoadingBlock rows={6} />}><AgentBuilder key={slug} slug={slug} /></Suspense></Page>;
}
