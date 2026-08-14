import type { ReactNode } from "react";
import { cx } from "@/lib/utils";

type TagTone = "neutral" | "brand" | "success" | "warning" | "error" | "info";

const TAG_CLASSES: Record<TagTone, string> = {
  neutral: "border-(--color-border-default) bg-transparent text-(--color-text-secondary)",
  brand: "border-(--color-border-brand) bg-transparent text-(--color-text-brand)",
  success: "border-(--color-state-success) bg-transparent text-(--color-state-success)",
  warning: "border-(--color-state-warning) bg-transparent text-(--color-state-warning)",
  error: "border-(--color-state-error) bg-transparent text-(--color-state-error)",
  info: "border-(--color-state-info) bg-transparent text-(--color-state-info)",
};

export function Tag({ children, tone = "neutral", className }: { children: ReactNode; tone?: TagTone; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-[3px] border px-2 py-1 text-[0.68rem] font-bold uppercase tracking-[0.08em]", TAG_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

export const Badge = Tag;

export function ModuleTag({ name, accentColor, className }: { name: string; accentColor: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 border-b border-(--color-border-default) py-1 text-xs font-semibold text-(--color-text-primary) transition-[border-color,color] duration-(--duration-fast) hover:border-(--color-text-primary)",
        className,
      )}
    >
      <span className="h-2.5 w-[3px] flex-none" style={{ backgroundColor: accentColor }} aria-hidden="true" />
      {name}
    </span>
  );
}
