"use client";

import { createContext, useContext } from "react";
import type { OfficeLayoutSpec, OfficeState } from "@/lib/office/types";

export type DirectoryEntry = OfficeState["directory"][number];

interface OfficeDirectoryValue {
  get: (slug: string | null | undefined) => DirectoryEntry | undefined;
  list: DirectoryEntry[];
  layout: OfficeLayoutSpec | null;
}

const Ctx = createContext<OfficeDirectoryValue>({ get: () => undefined, list: [], layout: null });

/** Provides database-driven agent names/colours and the office layout to all office panels. */
export function OfficeDirectoryProvider({ directory, layout, children }: { directory: DirectoryEntry[]; layout: OfficeLayoutSpec | null; children: React.ReactNode }) {
  const map = new Map(directory.map((d) => [d.slug, d]));
  return <Ctx.Provider value={{ get: (s) => (s ? map.get(s) : undefined), list: directory, layout }}>{children}</Ctx.Provider>;
}

export function useOfficeDirectory() {
  return useContext(Ctx);
}

/** Human label for any zone key (department, meeting room, lounge). */
export function zoneName(layout: OfficeLayoutSpec | null, key: string | null | undefined, locale: "en" | "ar", t: (k: string) => string): string {
  if (!key) return "—";
  const dept = layout?.departments.find((d) => d.key === key);
  if (dept) return locale === "ar" ? dept.nameAr : dept.name;
  const room = layout?.meetingRooms.find((r) => r.key === key);
  if (room) return locale === "ar" ? room.nameAr : room.name;
  if (key.startsWith("lounge")) return t("office.zone.lounge");
  if (key.startsWith("meeting_room")) return t("office.zone.meeting_room");
  return key;
}
