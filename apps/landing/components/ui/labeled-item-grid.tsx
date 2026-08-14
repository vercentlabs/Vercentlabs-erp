import { Text } from "@/components/ui/text";

interface LabeledItem { title: string; description: string; }

export function LabeledItemGrid({
  items,
  columns = 2,
  reveal = false,
}: {
  items: LabeledItem[];
  columns?: 1 | 2 | 3 | 4;
  reveal?: boolean;
}) {
  const desktopColumns = columns === 1 ? "lg:grid-cols-1" : columns === 2 ? "lg:grid-cols-2" : columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4";
  return (
    <div className={`grid grid-cols-1 gap-x-8 ${desktopColumns}`}>
      {items.map((item, index) => (
        <div
          key={item.title}
          data-reveal-item={reveal ? "" : undefined}
          style={reveal ? { transitionDelay: `${Math.min(index, 4) * 60}ms` } : undefined}
          className="grid min-h-36 grid-cols-[2.5rem_1fr] gap-4 border-t border-(--color-border-strong) py-6 sm:min-h-40 sm:py-7"
        >
          <Text variant="caption" className="vl-index pt-1 text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</Text>
          <div>
            <Text variant="label" className="text-base tracking-[-0.025em] text-(--color-text-primary)">{item.title}</Text>
            {item.description ? <Text variant="bodySmall" className="mt-3 max-w-[54ch]">{item.description}</Text> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
