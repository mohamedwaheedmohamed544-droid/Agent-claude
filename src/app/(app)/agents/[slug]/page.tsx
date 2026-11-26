"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { Page } from "@/components/page";
import { LoadingBlock } from "@/components/ui";
import { AgentProfile } from "@/components/agent-management/profile";

export default function AgentProfilePage() {
  const { slug } = useParams<{ slug: string }>();
  return <Page wide><Suspense fallback={<LoadingBlock rows={6} />}><AgentProfile key={slug} slug={slug} /></Suspense></Page>;
}
