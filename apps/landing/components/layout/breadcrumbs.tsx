import Link from "next/link";
import { breadcrumbJsonLd, jsonLdScriptProps, type BreadcrumbEntry } from "@/lib/seo/json-ld";

export function Breadcrumbs({ trail }: { trail: BreadcrumbEntry[] }) {
  if (trail.length === 0) return null;
  const fullTrail: BreadcrumbEntry[] = [{ name: "Home", path: "/" }, ...trail];

  return (
    <nav aria-label="Breadcrumb" className="border-b border-(--color-border-default) pb-3 text-xs">
      <ol className="flex flex-wrap items-center gap-2 text-(--color-text-muted)">
        {fullTrail.map((entry, index) => {
          const isLast = index === fullTrail.length - 1;
          return (
            <li key={entry.path} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true" className="text-(--color-border-strong)">→</span> : null}
              {isLast ? (
                <span aria-current="page" className="max-w-[40ch] truncate font-bold uppercase tracking-[0.08em] text-(--color-text-primary)">{entry.name}</span>
              ) : (
                <Link href={entry.path} className="max-w-[24ch] truncate font-semibold hover:text-(--color-text-brand)">{entry.name}</Link>
              )}
            </li>
          );
        })}
      </ol>
      <script {...jsonLdScriptProps(breadcrumbJsonLd(fullTrail))} />
    </nav>
  );
}
