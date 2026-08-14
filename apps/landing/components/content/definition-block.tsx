import { Text } from "@/components/ui/text";

export function DefinitionBlock({ term, definition, className }: { term: string; definition: string; className?: string }) {
  return (
    <div className={className}>
      <div className="grid grid-cols-[6px_1fr] border-y border-r border-(--color-border-strong) bg-(--color-bg-elevated)">
        <span className="bg-(--color-bg-brand)" aria-hidden="true" />
        <div className="p-5 sm:p-7">
          <Text variant="eyebrow" as="p">{term}</Text>
          <Text variant="bodyLarge" className="mt-4 max-w-[66ch] font-semibold tracking-[-0.02em]">{definition}</Text>
        </div>
      </div>
    </div>
  );
}
