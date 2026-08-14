import { Text } from "@/components/ui/text";
import { TrackedLink } from "@/components/analytics/tracked-cta-link";
import type { EditorialSource } from "@vercentlabs/landing-content";

const SOURCE_TYPE_LABEL: Record<EditorialSource["sourceType"], string> = {
  government: "Government", standard: "Standards body", vendor: "Vendor (primary source)",
  "industry-body": "Industry body", research: "Research", documentation: "Documentation",
};

export function SourceList({ sources, className }: { sources: EditorialSource[]; className?: string }) {
  if (sources.length === 0) return null;
  return (
    <div className={className}>
      <div className="flex items-end justify-between border-b border-(--color-border-strong) pb-4">
        <Text variant="dataLabel" as="p">Sources / evidence register</Text>
        <span className="tabular-data text-4xl font-semibold tracking-[-0.06em] text-(--color-text-primary)">{String(sources.length).padStart(2, "0")}</span>
      </div>
      <ol>
        {sources.map((source, index) => (
          <li key={source.id} className="grid grid-cols-[2rem_1fr] gap-3 border-b border-(--color-border-default) py-4 sm:grid-cols-[3rem_1fr_auto]">
            <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <TrackedLink href={source.url} event="source_link_click" ctaLocation={`source_${source.id}`} external className="font-semibold">{source.title}</TrackedLink>
              <p className="mt-1 text-xs text-(--color-text-muted)">{source.publisher} · {SOURCE_TYPE_LABEL[source.sourceType]}</p>
            </div>
            <span className="col-start-2 text-xs text-(--color-text-muted) sm:col-start-3">Retrieved {source.retrievedAt}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
