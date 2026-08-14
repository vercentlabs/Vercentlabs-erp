import { Text } from "@/components/ui/text";

export interface TocEntry { id: string; label: string; }

export function TableOfContents({ entries, className }: { entries: TocEntry[]; className?: string }) {
  if (entries.length < 2) return null;
  return (
    <nav aria-label="Table of contents" className={className}>
      <div className="flex items-end justify-between border-b border-(--color-border-strong) pb-3">
        <Text variant="dataLabel" as="p">On this page</Text>
        <span className="vl-index">{String(entries.length).padStart(2, "0")}</span>
      </div>
      <ol>
        {entries.map((entry, index) => (
          <li key={entry.id} className="border-b border-(--color-border-default)">
            <a href={`#${entry.id}`} className="group grid grid-cols-[2rem_1fr] gap-2 py-3 text-sm text-(--color-text-secondary) hover:text-(--color-text-brand)">
              <span className="vl-index group-hover:text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
              <span>{entry.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
