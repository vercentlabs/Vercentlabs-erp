import { Inline } from "@/components/layout/container";
import { Text } from "@/components/ui/text";
import type { ContentAuthor, ContentFreshness } from "@vercentlabs/landing-content";

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * Renders the real, per-route CONTENT_FRESHNESS dates and author byline —
 * never a hard-coded "Updated today" label. See freshness.js's own header
 * comment: dates here must reflect a real change, not build time.
 */
export function ContentFreshnessMeta({ author, freshness }: { author: ContentAuthor; freshness: ContentFreshness }) {
  return (
    <Inline gap={2} className="flex-wrap text-xs text-(--color-text-muted)">
      <Text variant="caption" as="span">
        By {author.name}
      </Text>
      <span aria-hidden="true">·</span>
      <Text variant="caption" as="span">
        Published {formatDate(freshness.publishedAt)}
      </Text>
      <span aria-hidden="true">·</span>
      <Text variant="caption" as="span" role="note">
        Last reviewed {formatDate(freshness.lastReviewedAt)}
      </Text>
    </Inline>
  );
}
