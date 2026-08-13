import { Grid } from "@/components/layout/container";
import { Text } from "@/components/ui/text";

interface LabeledItem {
  title: string;
  description: string;
}

/**
 * The "label + short description" grid repeated raw across four homepage
 * sections in Phase 3 (problem framing, role value, security, breadth) —
 * extracted here once Phase 4 gives it 40+ real call sites across module and
 * platform pages. See docs/landing-redesign/phase-3/decision-log.md and
 * docs/landing-redesign/phase-4/decision-log.md for the extraction record.
 */
export function LabeledItemGrid({
  items,
  columns = 2,
  reveal = false,
}: {
  items: LabeledItem[];
  columns?: 1 | 2 | 3 | 4;
  /** Forwarded straight to Grid — see components/motion/reveal.tsx. */
  reveal?: boolean;
}) {
  return (
    <Grid columns={columns} gap={1} reveal={reveal} className="gap-x-8 gap-y-0 border-t border-(--color-border-default)">
      {items.map((item, index) => (
        <div
          key={item.title}
          className="border-b border-(--color-border-default) py-6 md:min-h-40 md:pr-8"
        >
          <Text variant="caption" className="mb-5 tabular-nums text-(--color-text-brand)">
            {String(index + 1).padStart(2, "0")}
          </Text>
          <Text variant="label" className="text-(--color-text-primary)">{item.title}</Text>
          {item.description ? <Text variant="bodySmall" className="mt-2 max-w-[54ch]">
            {item.description}
          </Text> : null}
        </div>
      ))}
    </Grid>
  );
}
