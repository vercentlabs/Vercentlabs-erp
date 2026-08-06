"use client";

import Link from "next/link";
import { track } from "@/lib/analytics";
import type { AnalyticsEventName } from "@/lib/analytics";

/**
 * Mobile-only conversion bar, fixed to the bottom of the viewport. Hidden at
 * `lg` and above, where the header CTA is already visible without scrolling.
 * A matching spacer in the page (see app/page.tsx) reserves room below the
 * final CTA section so this bar never covers footer content — the spacer's
 * height must stay >= this bar's own rendered height (11 (44px) + 2 * 0.75rem
 * padding, before any safe-area inset), or the tail of the final section can
 * peek out from under the bar on notched/home-indicator phones.
 */
export function StickyMobileCta({ href, label, event }: { href: string; label: string; event: AnalyticsEventName }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-(--color-border-default) bg-(--color-bg-elevated) p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-(--shadow-panel) lg:hidden">
      <Link
        href={href}
        prefetch={false}
        onClick={() => track(event, { ctaLocation: "sticky_mobile_bar", ctaDestination: href })}
        className="flex h-11 w-full items-center justify-center rounded-(--radius-control) bg-(--color-bg-brand) text-sm font-semibold text-(--color-text-inverse)"
      >
        {label}
      </Link>
    </div>
  );
}
