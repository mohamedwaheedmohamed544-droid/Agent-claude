"use client";

import { Page } from "@/components/page";
import { PageHeader } from "@/components/ui";
import { useApp } from "@/components/providers";

// Placeholder — replaced by the settings page implementation.
export default function Placeholder() {
  const { t } = useApp();
  return <Page><PageHeader title={t("nav.settings")} /></Page>;
}
