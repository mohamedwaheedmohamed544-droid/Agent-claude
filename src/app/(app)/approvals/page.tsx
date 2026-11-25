"use client";

import { ShieldCheck } from "lucide-react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { useApp } from "@/components/providers";
import { ApprovalCenter } from "@/components/approvals/approval-center";

export default function ApprovalsPage() {
  const { t } = useApp();
  return (
    <Page>
      <PageHeader icon={<ShieldCheck className="size-5" />} title={t("nav.approvals")} description={t("approvals.description")} />
      <ApprovalCenter />
    </Page>
  );
}
