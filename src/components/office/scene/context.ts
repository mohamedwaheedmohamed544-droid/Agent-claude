"use client";

import { createContext, useContext } from "react";
import type { QualityTier, SceneResources } from "./resources";
import type { OfficeSim } from "./simulation";
import type { OverlayRegistry } from "./overlay";

export interface SceneCtx {
  res: SceneResources;
  sim: OfficeSim;
  overlay: OverlayRegistry;
  tier: QualityTier;
  locale: "en" | "ar";
  reducedMotion: boolean;
}

export const SceneContext = createContext<SceneCtx | null>(null);

export function useScene(): SceneCtx {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useScene must be used inside <OfficeScene>");
  return ctx;
}
