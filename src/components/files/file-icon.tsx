import { File, FileBraces, FileSpreadsheet, FileText, FileType, Presentation } from "lucide-react";
import { cx } from "../ui";

type Kind = "pdf" | "doc" | "sheet" | "slides" | "json" | "text";

/** Subtle per-type tints; the only non-token colours on these pages, mixed at low opacity so they work in both themes. */
const STYLE: Record<Kind, { color: string; Icon: React.ComponentType<{ className?: string }> }> = {
  pdf: { color: "#dc2626", Icon: FileText },
  doc: { color: "#2563eb", Icon: FileType },
  sheet: { color: "#16a34a", Icon: FileSpreadsheet },
  slides: { color: "#ea580c", Icon: Presentation },
  json: { color: "#7c3aed", Icon: FileBraces },
  text: { color: "#64748b", Icon: File },
};

export function fileKind(filename: string, mimeType = ""): Kind {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? "";
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf";
  if (ext === "docx") return "doc";
  if (ext === "xlsx" || ext === "csv") return "sheet";
  if (ext === "pptx") return "slides";
  if (ext === "json") return "json";
  return "text";
}

export function fileExtLabel(filename: string): string {
  return (/\.([a-z0-9]+)$/i.exec(filename)?.[1] ?? "").toUpperCase();
}

export function FileTypeIcon({ filename, mimeType, size = "md", className }: { filename: string; mimeType?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const { color, Icon } = STYLE[fileKind(filename, mimeType)];
  const box = { sm: "size-7 rounded-md", md: "size-9 rounded-lg", lg: "size-11 rounded-xl" }[size];
  const icon = { sm: "size-3.5", md: "size-4", lg: "size-5" }[size];
  return (
    <span
      aria-hidden
      className={cx("grid shrink-0 place-items-center", box, className)}
      style={{ background: `color-mix(in srgb, ${color} 13%, transparent)`, color }}
    >
      <Icon className={icon} />
    </span>
  );
}
