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
export function LabeledItemGrid({ items, columns = 2 }: { items: LabeledItem[]; columns?: 1 | 2 | 3 | 4 }) {
  return (
    <Grid columns={columns} gap={6}>
      {items.map((item) => (
        <div key={item.title}>
          <Text variant="label">{item.title}</Text>
          <Text variant="bodySmall" className="mt-1.5">
            {item.description}
          </Text>
        </div>
      ))}
    </Grid>
  );
}
