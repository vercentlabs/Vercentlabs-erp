import { Text } from "@/components/ui/text";

export function BeforeAfterSystem({ before, after }: { before: string; after: string }) {
  return (
    <div className="grid grid-cols-1 border-y border-(--color-border-strong) md:grid-cols-2">
      <div className="border-b border-(--color-border-default) p-6 md:border-b-0 md:border-r md:p-8">
        <div className="flex items-center justify-between"><Text variant="eyebrow">Before</Text><span className="vl-index">01</span></div>
        <Text variant="bodyLarge" className="mt-8 max-w-[52ch]">{before}</Text>
      </div>
      <div className="bg-(--color-bg-elevated) p-6 md:p-8">
        <div className="flex items-center justify-between"><Text variant="eyebrow">After</Text><span className="vl-index text-(--color-text-brand)">02</span></div>
        <Text variant="bodyLarge" className="mt-8 max-w-[52ch] font-semibold">{after}</Text>
      </div>
    </div>
  );
}
