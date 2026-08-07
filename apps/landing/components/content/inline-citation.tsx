import { TrackedLink } from "@/components/analytics/tracked-cta-link";
import type { EditorialSource } from "@vercentlabs/landing-content";

/** A small inline citation marker for a claim in running copy — links straight to the source, not a footnote jump. */
export function InlineCitation({ source }: { source: EditorialSource }) {
  return (
    <TrackedLink
      href={source.url}
      event="source_link_click"
      ctaLocation={`inline_citation_${source.id}`}
      external
      className="ml-0.5 align-super text-[0.7em] no-underline text-(--color-text-brand) hover:underline"
    >
      [{source.publisher}]
    </TrackedLink>
  );
}
