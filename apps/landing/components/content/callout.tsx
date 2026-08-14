import type { ReactNode } from "react";
import { cx } from "@/lib/utils";
import { Text } from "@/components/ui/text";

type CalloutTone = "note" | "caution";
const TONE_CLASSES: Record<CalloutTone, string> = {
  note: "border-(--color-border-strong)",
  caution: "border-(--color-text-brand)",
};

export function Callout({ tone = "note", label, children, className }: { tone?: CalloutTone; label?: string; children: ReactNode; className?: string }) {
  return (
    <aside className={cx("grid grid-cols-[5px_1fr] border-y border-r bg-(--color-bg-subtle)", TONE_CLASSES[tone], className)}>
      <span className={tone === "caution" ? "bg-(--color-text-brand)" : "bg-(--color-border-strong)"} aria-hidden="true" />
      <div className="p-5 sm:p-6">
        {label ? <Text variant="dataLabel" as="p" className="mb-2">{label}</Text> : null}
        <Text variant="bodySmall">{children}</Text>
      </div>
    </aside>
  );
}
