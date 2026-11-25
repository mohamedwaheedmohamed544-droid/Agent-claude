import Link from "next/link";
import { cx } from "@/components/ui";

const VARIANT = {
  primary: "bg-accent text-white hover:bg-accent-hover shadow-card",
  outline: "bg-surface text-fg border border-border hover:bg-surface-2",
} as const;

/** A Next.js Link styled like the design-system Button (avoids nesting <button> inside <a>). */
export function LinkButton({ href, children, icon, variant = "outline", size = "md", className }: {
  href: string; children: React.ReactNode; icon?: React.ReactNode; variant?: keyof typeof VARIANT; size?: "sm" | "md"; className?: string;
}) {
  return (
    <Link href={href} className={cx(
      "inline-flex items-center font-medium whitespace-nowrap transition-colors",
      size === "sm" ? "h-8 gap-1.5 rounded-lg px-3 text-[13px]" : "h-9 gap-2 rounded-lg px-3.5 text-sm",
      VARIANT[variant], className,
    )}>
      {icon}{children}
    </Link>
  );
}
