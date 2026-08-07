import { Text } from "@/components/ui/text";

export interface TocEntry {
  id: string;
  label: string;
}

/**
 * Server-rendered, plain anchor links — no JS scroll-spy, no sticky mobile
 * overlay. Normal anchor behavior (browser handles focus/scroll), keyboard
 * accessible by default. Per Workstream Q/table-of-contents guidance:
 * restrained, not a UI feature in its own right.
 */
export function TableOfContents({ entries, className }: { entries: TocEntry[]; className?: string }) {
  if (entries.length < 2) return null;
  return (
    <nav aria-label="Table of contents" className={className}>
      <Text variant="dataLabel" as="p" className="mb-3">
        On this page
      </Text>
      <ol className="flex flex-col gap-2 border-l border-(--color-border-default) pl-4 text-sm">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a href={`#${entry.id}`} className="text-(--color-text-secondary) hover:text-(--color-text-brand) hover:underline underline-offset-4">
              {entry.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
