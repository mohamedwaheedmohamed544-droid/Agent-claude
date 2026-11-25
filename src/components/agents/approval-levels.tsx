"use client";

import { RiskBadge, cx } from "@/components/ui";
import { useApp } from "@/components/providers";

/**
 * The L1–L4 autonomy policy, explained. Mirrors src/lib/tools/executor.ts:
 * L1 read & L2 prepare run automatically; L3 modify needs approval unless the workspace
 * enables auto-approval; L4 external ALWAYS needs explicit approval of the exact parameters.
 */
export function ApprovalLevels({ autoApproveLevel3, compact }: { autoApproveLevel3?: boolean; compact?: boolean }) {
  const { t } = useApp();
  const levels = [1, 2, 3, 4] as const;
  const policy = (l: number) => {
    if (l <= 2) return { text: t("agents.levels.auto"), cls: "text-success" };
    if (l === 3) {
      if (autoApproveLevel3 === undefined) return { text: t("agents.levels.l3Policy"), cls: "text-warning" };
      return autoApproveLevel3 ? { text: t("agents.levels.l3Auto"), cls: "text-warning" } : { text: t("agents.levels.needsApproval"), cls: "text-warning" };
    }
    return { text: t("agents.levels.always"), cls: "text-danger" };
  };
  return (
    <ul className={cx("grid gap-2", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
      {levels.map((l) => {
        const p = policy(l);
        return (
          <li key={l} className="rounded-xl border border-border bg-surface-2/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <RiskBadge level={l} />
              <span className={cx("text-[12px] font-medium", p.cls)}>{p.text}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{t(`agents.levels.l${l}`)}</p>
          </li>
        );
      })}
    </ul>
  );
}
