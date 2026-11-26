"use client";

import { Suspense } from "react";
import { Page } from "@/components/page";
import { OfficeView } from "@/components/office/office-view";

export default function OfficePage() {
  return (
    <Page flush>
      <Suspense><OfficeView /></Suspense>
    </Page>
  );
}
