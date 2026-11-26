import type { AgentProfile } from "./types";

/** Seed data for the starter workforce (see src/lib/agents/catalog.ts). Not used to decide which agents exist. */
export type SeedProfile = Omit<AgentProfile, "workstationId" | "defaultAnimation" | "isOrchestrator">;

/**
 * The Nexus workforce. Slugs match the orchestration backend (agent_slug); "orchestrator" is راشد.
 * Characters are stylized adult professionals in contemporary Gulf business attire.
 */
export const AGENT_PROFILES: SeedProfile[] = [
  {
    slug: "orchestrator", nameAr: "راشد", nameEn: "Rashed", titleAr: "المنسّق الرئيسي", titleEn: "Chief Orchestrator",
    color: "#4f46e5", deskZone: "executive",
    appearance: { gender: "male", skin: "#c69276", outfit: "thobe", outfitColor: "#f4f1ea", headwear: "shemagh", headwearColor: "#b3262f", hairColor: "#1f1a17", accessory: "watch", height: 1.82 },
  },
  {
    slug: "research", nameAr: "باحث", nameEn: "Baheth", titleAr: "وكيل البحث", titleEn: "Research Agent",
    color: "#2563eb", deskZone: "research",
    appearance: { gender: "male", skin: "#b98466", outfit: "thobe", outfitColor: "#eef1f4", headwear: "ghutra", headwearColor: "#f8f8f6", hairColor: "#231d19", accessory: "glasses", height: 1.76 },
  },
  {
    slug: "business_development", nameAr: "رائد", nameEn: "Raed", titleAr: "وكيل تطوير الأعمال", titleEn: "Business Development Agent",
    color: "#0d9488", deskZone: "bizdev",
    appearance: { gender: "male", skin: "#a87358", outfit: "suit", outfitColor: "#1f2a37", headwear: "none", headwearColor: "#000000", hairColor: "#17120f", accessory: "tablet", height: 1.8 },
  },
  {
    slug: "documents", nameAr: "بيان", nameEn: "Bayan", titleAr: "وكيلة المستندات", titleEn: "Documents Agent",
    color: "#7c3aed", deskZone: "documents",
    appearance: { gender: "female", skin: "#c99a7e", outfit: "abaya", outfitColor: "#1c1b29", headwear: "hijab", headwearColor: "#3b2a6b", hairColor: "#1b1513", accessory: "folder", height: 1.65 },
  },
  {
    slug: "writing", nameAr: "قلم", nameEn: "Qalam", titleAr: "وكيل الكتابة", titleEn: "Writing Agent",
    color: "#db2777", deskZone: "writing",
    appearance: { gender: "male", skin: "#bf8b6c", outfit: "shirt", outfitColor: "#e9e4f2", headwear: "none", headwearColor: "#000000", hairColor: "#2a211c", accessory: "pen", height: 1.74 },
  },
  {
    slug: "analytics", nameAr: "بصيرة", nameEn: "Basira", titleAr: "وكيلة التحليلات", titleEn: "Analytics Agent",
    color: "#ea580c", deskZone: "analytics",
    appearance: { gender: "female", skin: "#b88466", outfit: "blazer", outfitColor: "#2b3440", headwear: "hijab", headwearColor: "#0f766e", hairColor: "#1a1412", accessory: "laptop", height: 1.66 },
  },
  {
    slug: "operations", nameAr: "تميم", nameEn: "Tamim", titleAr: "وكيل العمليات", titleEn: "Operations Agent",
    color: "#16a34a", deskZone: "operations",
    appearance: { gender: "male", skin: "#a9785d", outfit: "thobe", outfitColor: "#e6e2d6", headwear: "shemagh", headwearColor: "#f3f3f0", hairColor: "#1c1714", accessory: "headset", height: 1.78 },
  },
  {
    slug: "marketing", nameAr: "أثر", nameEn: "Athar", titleAr: "وكيلة الذكاء التسويقي", titleEn: "Marketing Intelligence Agent",
    color: "#ca8a04", deskZone: "marketing",
    appearance: { gender: "female", skin: "#c4917a", outfit: "abaya", outfitColor: "#2a2421", headwear: "hijab", headwearColor: "#b45309", hairColor: "#1e1714", accessory: "tablet", height: 1.64 },
  },
];

