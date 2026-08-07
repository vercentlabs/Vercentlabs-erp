import { BorderedPanel, Checklist } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

/** A short, scannable summary block near the top of a long-form resource — real takeaways, not filler. */
export function KeyTakeaways({ items, className }: { items: string[]; className?: string }) {
  return (
    <BorderedPanel className={className}>
      <Text variant="label" as="p" className="mb-3">
        Key takeaways
      </Text>
      <Checklist items={items} />
    </BorderedPanel>
  );
}
