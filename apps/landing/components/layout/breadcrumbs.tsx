import Link from "next/link";
import { breadcrumbJsonLd, jsonLdScriptProps, type BreadcrumbEntry } from "@/lib/seo/json-ld";

/**
 * Never rendered on the homepage (per the brief). Generated from explicit page
 * context passed by the caller, not parsed from the URL — a URL segment is not
 * always a good breadcrumb label (e.g. a module key vs. its display name).
 */
export function Breadcrumbs({ trail }: { trail: BreadcrumbEntry[] }) {
  if (trail.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-(--color-text-muted)">
        {trail.map((entry, index) => {
          const isLast = index === trail.length - 1;
          return (
            <li key={entry.path} className="flex items-center gap-1.5">
              {index > 0 ? (
                <span aria-hidden="true" className="text-(--color-border-strong)">
                  /
                </span>
              ) : null}
              {isLast ? (
                <span aria-current="page" className="max-w-[40ch] truncate font-medium text-(--color-text-primary)">
                  {entry.name}
                </span>
              ) : (
                <Link href={entry.path} className="max-w-[24ch] truncate hover:text-(--color-text-brand)">
                  {entry.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      <script {...jsonLdScriptProps(breadcrumbJsonLd(trail))} />
    </nav>
  );
}
