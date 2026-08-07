import type { ReactNode } from "react";
import { cx } from "@/lib/utils";
import { Text } from "@/components/ui/text";

type CalloutTone = "note" | "caution";

const TONE_CLASSES: Record<CalloutTone, string> = {
  note: "border-(--color-border-default) bg-(--color-bg-subtle)",
  caution: "border-(--color-text-brand) bg-(--color-bg-subtle)",
};

/** A highlighted aside for a real caveat, limitation, or honest scope note — not decorative. */
export function Callout({ tone = "note", label, children, className }: { tone?: CalloutTone; label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-(--radius-panel) border-l-4 p-5", TONE_CLASSES[tone], className)}>
      {label ? (
        <Text variant="dataLabel" as="p" className="mb-1.5">
          {label}
        </Text>
      ) : null}
      <Text variant="bodySmall">{children}</Text>
    </div>
  );
}
