"use client";

import { BarChart3, FileSearch, Search, Users } from "lucide-react";
import { useApp } from "@/components/providers";
import { AgentAvatar, cx } from "@/components/ui";

/** Prompts that showcase multi-agent work. Text lives in i18n so it is natural in both languages. */
export const SUGGESTED_PROMPTS = [
  { id: "research", icon: Search, agents: ["research", "writing"] },
  { id: "rfp", icon: FileSearch, agents: ["documents", "business_development", "writing"] },
  { id: "leads", icon: Users, agents: ["research", "business_development"] },
  { id: "kpi", icon: BarChart3, agents: ["analytics", "writing"] },
] as const;

export function SuggestedPrompts({ onPick, className }: { onPick: (text: string) => void; className?: string }) {
  const { t } = useApp();
  return (
    <ul className={cx("grid gap-2.5 sm:grid-cols-2", className)}>
      {SUGGESTED_PROMPTS.map((p) => {
        const Icon = p.icon;
        const text = t(`chat.prompt.${p.id}.text`);
        return (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(text)}
              className="group flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-surface p-3.5 text-start shadow-card transition-colors hover:border-accent/50 hover:bg-accent-soft/40">
              <span className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-surface-2 text-fg-2 group-hover:bg-accent-soft group-hover:text-accent-text"><Icon className="size-4" /></span>
                <span className="text-[13.5px] font-semibold text-fg">{t(`chat.prompt.${p.id}.title`)}</span>
              </span>
              <span className="line-clamp-2 text-[12.5px] leading-relaxed text-fg-3">{text}</span>
              <span className="mt-auto flex items-center gap-1" aria-label={p.agents.map((a) => t(`agent.${a}`)).join(", ")}>
                {p.agents.map((a) => <AgentAvatar key={a} slug={a} size="sm" className="size-5!" />)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
