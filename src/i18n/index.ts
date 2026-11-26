import { common } from "./messages/common";
import { dashboard } from "./messages/dashboard";
import { chat } from "./messages/chat";
import { agents } from "./messages/agents";
import { tasks } from "./messages/tasks";
import { approvals } from "./messages/approvals";
import { knowledge } from "./messages/knowledge";
import { files } from "./messages/files";
import { integrations } from "./messages/integrations";
import { memory } from "./messages/memory";
import { activity } from "./messages/activity";
import { analytics } from "./messages/analytics";
import { settings } from "./messages/settings";
import { office } from "./messages/office";

export type Locale = "en" | "ar";
export const LOCALES: Locale[] = ["en", "ar"];

const NAMESPACES = [common, dashboard, chat, agents, tasks, approvals, knowledge, files, integrations, memory, activity, analytics, settings, office];

const DICTS: Record<Locale, Record<string, string>> = {
  en: Object.assign({}, ...NAMESPACES.map((n) => n.en)),
  ar: Object.assign({}, ...NAMESPACES.map((n) => n.ar)),
};

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

export function createT(locale: Locale): TFunction {
  const dict = DICTS[locale] ?? DICTS.en;
  return (key, vars) => {
    let s = dict[key] ?? DICTS.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function normalizeLocale(v: string | undefined | null): Locale {
  return v === "ar" ? "ar" : "en";
}
