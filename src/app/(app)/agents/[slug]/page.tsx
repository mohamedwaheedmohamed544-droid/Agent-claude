"use client";

import { useParams } from "next/navigation";
import { Page } from "@/components/page";
import { AgentDetail } from "@/components/agents/agent-detail";

export default function AgentDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  return <Page wide><AgentDetail key={slug} slug={slug} /></Page>;
}
