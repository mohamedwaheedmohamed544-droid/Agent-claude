"use client";

import { Badge, RiskBadge } from "@/components/ui";
import { useApp } from "@/components/providers";
import { AVATAR_BY_KEY } from "@/lib/office/avatars";
import { AgentFace, ChipRow } from "./shared";
import { localDept, localName, localRole, localSkill, type AgentDefinitionInput, type DepartmentRecord, type SkillRecord, type ToolInfo } from "./types";

/** Read-only overview of a full agent configuration (NL proposal, import preview, template preview). */
export function ConfigSummary({ config: c, skills, tools, departments, agentsBySlug }: {
  config: AgentDefinitionInput; skills?: SkillRecord[]; tools?: ToolInfo[]; departments?: DepartmentRecord[];
  agentsBySlug?: Map<string, { nameAr: string; nameEn: string }>;
}) {
  const { t, locale } = useApp();
  const skillMap = new Map((skills ?? []).map((s) => [s.key, s]));
  const toolMap = new Map((tools ?? []).map((x) => [x.name, x]));
  const dept = departments?.find((d) => d.key === c.office.departmentKey);
  const preset = AVATAR_BY_KEY.get(c.office.avatarPreset);
  const agentLabel = (slug: string) => { const a = agentsBySlug?.get(slug); return a ? localName(a, locale) : slug; };

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start gap-3">
        <AgentFace color={c.color} appearance={c.office.appearance} name={c.nameEn} size="lg" />
        <div className="min-w-0">
          <p className="text-lg font-semibold text-fg" dir="rtl" lang="ar">{c.nameAr || "—"}</p>
          <p className="text-[13px] text-fg-2" dir="ltr">{c.nameEn || "—"}</p>
          <p className="mt-0.5 text-[13px] text-fg-3">{localRole(c, locale)}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {dept ? <Badge tone="neutral"><span className="size-2 rounded-full" style={{ background: dept.color }} />{localDept(dept, locale)}</Badge>
              : c.office.departmentKey ? <Badge tone="warning">{c.office.departmentKey}</Badge> : null}
            <Badge tone="neutral">{t(`agents.tier.${c.ai.tier}`)}</Badge>
            {preset && <Badge tone="neutral">{locale === "ar" ? preset.labelAr : preset.label}</Badge>}
          </div>
        </div>
      </div>

      {(c.description || c.descriptionAr) && <p className="leading-relaxed text-fg-2">{locale === "ar" ? c.descriptionAr || c.description : c.description || c.descriptionAr}</p>}

      <SummaryBlock title={t("agents.builder.section.responsibilities")}>
        {c.responsibilities.main && <p className="leading-relaxed text-fg-2">{c.responsibilities.main}</p>}
        {c.responsibilities.expertise.length > 0 && <div className="mt-2"><ChipRow items={c.responsibilities.expertise} max={8} /></div>}
        {c.responsibilities.deliverables.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 ps-5 text-[13px] text-fg-2">{c.responsibilities.deliverables.map((d, i) => <li key={i}>{d}</li>)}</ul>
        )}
      </SummaryBlock>

      <SummaryBlock title={t("agents.builder.section.skills")}>
        {c.skills.length === 0 ? <p className="text-[13px] text-fg-3">{t("agents.builder.skills.none")}</p> : (
          <div className="flex flex-wrap gap-1.5">
            {c.skills.map((s) => {
              const rec = skillMap.get(s.key);
              return <Badge key={s.key} tone={rec ? "accent" : "warning"}>{rec ? localSkill(rec, locale) : s.key}{s.mandatory && " ★"}</Badge>;
            })}
          </div>
        )}
      </SummaryBlock>

      <SummaryBlock title={t("agents.builder.section.tools")}>
        {c.tools.length === 0 ? <p className="text-[13px] text-fg-3">{t("agents.tools.none")}</p> : (
          <ul className="flex flex-wrap gap-1.5">
            {c.tools.map((name) => {
              const tool = toolMap.get(name);
              return (
                <li key={name} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[12.5px]">
                  <span className="font-mono text-fg-2" dir="ltr">{name}</span>
                  {tool && <span className="text-[11px] text-fg-3">L{tool.riskLevel}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
          <span>{t("agents.builder.perm.maxRisk")}:</span><RiskBadge level={c.permissions.maxRiskLevel} />
          {c.permissions.alwaysApproveModify && <Badge tone="warning">{t("agents.builder.perm.alwaysApproveShort")}</Badge>}
          <Badge tone="neutral">{t(`agents.builder.perm.memory.${c.permissions.memoryAccess}`)}</Badge>
          {c.permissions.restrictedCategories.map((x) => <Badge key={x} tone="danger">{t("agents.builder.perm.restrictedShort", { c: t(`agents.category.${x}`) })}</Badge>)}
        </div>
      </SummaryBlock>

      {(c.relationships.supervisor || c.relationships.delegatesTo.length > 0 || c.relationships.collaboratesWith.length > 0) && (
        <SummaryBlock title={t("agents.builder.section.relationships")}>
          <dl className="grid gap-1 text-[13px]">
            {c.relationships.supervisor && <div className="flex gap-2"><dt className="text-fg-3">{t("agents.builder.rel.supervisor")}:</dt><dd className="text-fg-2">{agentLabel(c.relationships.supervisor)}</dd></div>}
            {c.relationships.delegatesTo.length > 0 && <div className="flex gap-2"><dt className="text-fg-3">{t("agents.builder.rel.delegatesTo")}:</dt><dd className="text-fg-2">{c.relationships.delegatesTo.map(agentLabel).join("، ")}</dd></div>}
            {c.relationships.collaboratesWith.length > 0 && <div className="flex gap-2"><dt className="text-fg-3">{t("agents.builder.rel.collaboratesWith")}:</dt><dd className="text-fg-2">{c.relationships.collaboratesWith.map(agentLabel).join("، ")}</dd></div>}
          </dl>
        </SummaryBlock>
      )}
    </div>
  );
}

function SummaryBlock({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">{title}</h3>
      {children}
    </section>
  );
}

/** Validation errors/warnings list (server `AgentValidation`). */
export function ValidationList({ errors, warnings }: { errors: Array<{ field: string; message: string }>; warnings: Array<{ field: string; message: string }> }) {
  if (!errors.length && !warnings.length) return null;
  return (
    <ul className="space-y-1.5 text-[13px]">
      {errors.map((e, i) => <li key={`e${i}`} className="rounded-lg bg-danger-soft px-3 py-1.5 text-danger">{e.field && <span className="font-mono text-[11.5px] opacity-80" dir="ltr">{e.field} · </span>}{e.message}</li>)}
      {warnings.map((e, i) => <li key={`w${i}`} className="rounded-lg bg-warning-soft px-3 py-1.5 text-warning">{e.field && <span className="font-mono text-[11.5px] opacity-80" dir="ltr">{e.field} · </span>}{e.message}</li>)}
    </ul>
  );
}
