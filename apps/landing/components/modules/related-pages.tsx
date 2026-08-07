import Link from "next/link";
import { Inline } from "@/components/layout/container";

interface RelatedPage {
  label: string;
  href: string;
}

/** Descriptive, natural anchors — never a generic "learn more" repeated across pages. */
export function RelatedPages({ pages }: { pages: RelatedPage[] }) {
  if (pages.length === 0) return null;
  return (
    <Inline gap={5} className="flex-wrap">
      {pages.map((page) => (
        <Link key={page.href} href={page.href} prefetch={false} className="text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4">
          {page.label} →
        </Link>
      ))}
    </Inline>
  );
}
