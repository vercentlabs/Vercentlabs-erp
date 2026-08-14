import { Checklist } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

export function KeyTakeaways({ items, className }: { items: string[]; className?: string }) {
  return (
    <div className={className}>
      <div className="grid grid-cols-1 border-y border-(--color-border-strong) bg-(--color-bg-subtle) sm:grid-cols-[180px_1fr]">
        <div className="border-b border-(--color-border-default) p-5 sm:border-b-0 sm:border-r">
          <Text variant="dataLabel" as="p">Key takeaways</Text>
          <span className="mt-4 block text-4xl font-semibold tracking-[-0.06em] text-(--color-text-primary)">{String(items.length).padStart(2, "0")}</span>
        </div>
        <div className="p-5 sm:p-6"><Checklist items={items} /></div>
      </div>
    </div>
  );
}
