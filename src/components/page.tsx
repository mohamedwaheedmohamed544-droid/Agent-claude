import { cx } from "./ui";

/** Standard page container. Use `wide` for data-dense pages, `flush` for full-bleed layouts like chat. */
export function Page({ children, wide, flush, className }: { children: React.ReactNode; wide?: boolean; flush?: boolean; className?: string }) {
  if (flush) return <div className={cx("h-[calc(100dvh-3.5rem)]", className)}>{children}</div>;
  return <div className={cx("mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8", wide ? "max-w-[1400px]" : "max-w-6xl", className)}>{children}</div>;
}
