import { Text } from "@/components/ui/text";
import { TrackedLink } from "@/components/analytics/tracked-cta-link";
import type { EditorialSource } from "@vercentlabs/landing-content";

const SOURCE_TYPE_LABEL: Record<EditorialSource["sourceType"], string> = {
  government: "Government",
  standard: "Standards body",
  vendor: "Vendor (primary source)",
  "industry-body": "Industry body",
  research: "Research",
  documentation: "Documentation",
};

/**
 * Real, tiered citations only — every entry here must be a live
 * EDITORIAL_SOURCES record with a retrievedAt date, never a fabricated
 * or unlinked "source." See .claude/rules/landing-content.md rule 2.
 */
export function SourceList({ sources, className }: { sources: EditorialSource[]; className?: string }) {
  if (sources.length === 0) return null;
  return (
    <div className={className}>
      <Text variant="label" as="p" className="mb-3">
        Sources
      </Text>
      <ol className="flex flex-col gap-2 text-sm">
        {sources.map((source) => (
          <li key={source.id} className="text-(--color-text-secondary)">
            <TrackedLink href={source.url} event="source_link_click" ctaLocation={`source_${source.id}`} external>
              {source.title}
            </TrackedLink>
            {" — "}
            {source.publisher} · {SOURCE_TYPE_LABEL[source.sourceType]} · retrieved {source.retrievedAt}
          </li>
        ))}
      </ol>
    </div>
  );
}
