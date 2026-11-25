"use client";

import { Page } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { useApp } from "@/components/providers";

// Placeholder — replaced by the tasks page implementation.
export default function Placeholder() {
  const { t } = useApp();
  return <Page><PageHeader title={t("nav.tasks")} /></Page>;
}
