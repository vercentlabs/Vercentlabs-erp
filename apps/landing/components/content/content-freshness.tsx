import type { ContentAuthor, ContentFreshness } from "@vercentlabs/landing-content";

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export function ContentFreshnessMeta({ author, freshness }: { author: ContentAuthor; freshness: ContentFreshness }) {
  const items = [
    ["Author", author.name],
    ["Published", formatDate(freshness.publishedAt)],
    ["Reviewed", formatDate(freshness.lastReviewedAt)],
  ];
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="border-l border-(--color-border-default) pl-3">
          <dt className="text-[0.62rem] font-bold uppercase tracking-[0.12em] text-(--color-text-muted)">{label}</dt>
          <dd className="mt-1 text-xs font-semibold text-(--color-text-primary)" role={label === "Reviewed" ? "note" : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
