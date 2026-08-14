import Link from "next/link";

interface RelatedPage { label: string; href: string; }

export function RelatedPages({ pages }: { pages: RelatedPage[] }) {
  if (pages.length === 0) return null;
  return (
    <div className="grid grid-cols-1 border-l border-t border-(--color-border-default) sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((page, index) => (
        <Link key={page.href} href={page.href} prefetch={false} className="group grid min-h-20 grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-r border-(--color-border-default) px-4 py-3 text-sm font-semibold text-(--color-text-primary) hover:bg-(--color-bg-elevated) hover:text-(--color-text-brand)">
          <span className="vl-index">{String(index + 1).padStart(2, "0")}</span>
          <span>{page.label}</span>
          <span className="transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>
        </Link>
      ))}
    </div>
  );
}
