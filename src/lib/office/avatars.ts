import type { CharacterAppearance } from "./types";

/**
 * Avatar library: reusable character looks for the procedural 3D characters. This is a catalogue of
 * appearances (not agents) — any agent can use any preset, or a custom appearance.
 */
export interface AvatarPreset {
  key: string;
  label: string;
  labelAr: string;
  appearance: CharacterAppearance;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { key: "executive_thobe_shemagh", label: "Executive — thobe & shemagh", labelAr: "تنفيذي — ثوب وشماغ", appearance: { gender: "male", skin: "#c69276", outfit: "thobe", outfitColor: "#f4f1ea", headwear: "shemagh", headwearColor: "#b3262f", hairColor: "#1f1a17", accessory: "watch", height: 1.82 } },
  { key: "analyst_thobe_ghutra", label: "Analyst — thobe & ghutra", labelAr: "محلل — ثوب وغترة", appearance: { gender: "male", skin: "#b98466", outfit: "thobe", outfitColor: "#eef1f4", headwear: "ghutra", headwearColor: "#f8f8f6", hairColor: "#231d19", accessory: "glasses", height: 1.76 } },
  { key: "coordinator_thobe_headset", label: "Coordinator — thobe & headset", labelAr: "منسق — ثوب وسماعة", appearance: { gender: "male", skin: "#a9785d", outfit: "thobe", outfitColor: "#e6e2d6", headwear: "shemagh", headwearColor: "#f3f3f0", hairColor: "#1c1714", accessory: "headset", height: 1.78 } },
  { key: "consultant_suit", label: "Consultant — suit", labelAr: "مستشار — بدلة", appearance: { gender: "male", skin: "#a87358", outfit: "suit", outfitColor: "#1f2a37", headwear: "none", headwearColor: "#000000", hairColor: "#17120f", accessory: "tablet", height: 1.8 } },
  { key: "writer_shirt", label: "Writer — shirt", labelAr: "كاتب — قميص", appearance: { gender: "male", skin: "#bf8b6c", outfit: "shirt", outfitColor: "#e9e4f2", headwear: "none", headwearColor: "#000000", hairColor: "#2a211c", accessory: "pen", height: 1.74 } },
  { key: "specialist_abaya_hijab", label: "Specialist — abaya & hijab", labelAr: "مختصة — عباءة وحجاب", appearance: { gender: "female", skin: "#c99a7e", outfit: "abaya", outfitColor: "#1c1b29", headwear: "hijab", headwearColor: "#3b2a6b", hairColor: "#1b1513", accessory: "folder", height: 1.65 } },
  { key: "analyst_blazer_hijab", label: "Analyst — blazer & hijab", labelAr: "محللة — سترة وحجاب", appearance: { gender: "female", skin: "#b88466", outfit: "blazer", outfitColor: "#2b3440", headwear: "hijab", headwearColor: "#0f766e", hairColor: "#1a1412", accessory: "laptop", height: 1.66 } },
  { key: "strategist_abaya_tablet", label: "Strategist — abaya & tablet", labelAr: "استراتيجية — عباءة ولوح", appearance: { gender: "female", skin: "#c4917a", outfit: "abaya", outfitColor: "#2a2421", headwear: "hijab", headwearColor: "#b45309", hairColor: "#1e1714", accessory: "tablet", height: 1.64 } },
  { key: "manager_blazer_hijab", label: "Manager — blazer & hijab", labelAr: "مديرة — سترة وحجاب", appearance: { gender: "female", skin: "#a97a62", outfit: "blazer", outfitColor: "#3f3a55", headwear: "hijab", headwearColor: "#1e293b", hairColor: "#15100e", accessory: "watch", height: 1.67 } },
  { key: "neutral_turtleneck", label: "Professional — turtleneck (neutral)", labelAr: "محترف — ياقة عالية (محايد)", appearance: { gender: "neutral", skin: "#b07c60", outfit: "turtleneck", outfitColor: "#24303f", headwear: "none", headwearColor: "#000000", hairColor: "#221a16", accessory: "laptop", height: 1.72 } },
  { key: "neutral_cardigan", label: "Professional — cardigan (neutral)", labelAr: "محترف — كارديجان (محايد)", appearance: { gender: "neutral", skin: "#c39278", outfit: "cardigan", outfitColor: "#6b5b4b", headwear: "none", headwearColor: "#000000", hairColor: "#2b201a", accessory: "glasses", height: 1.7 } },
  { key: "neutral_blazer", label: "Professional — blazer (neutral)", labelAr: "محترف — سترة (محايد)", appearance: { gender: "neutral", skin: "#9c6d55", outfit: "blazer", outfitColor: "#1f3b4d", headwear: "none", headwearColor: "#000000", hairColor: "#191310", accessory: "tablet", height: 1.73 } },
];

export const AVATAR_BY_KEY = new Map(AVATAR_PRESETS.map((a) => [a.key, a]));
export const DEFAULT_AVATAR = AVATAR_PRESETS[9];
