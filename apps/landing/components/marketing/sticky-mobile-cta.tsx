"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics";

/**
 * Mobile-only conversion bar, fixed to the bottom of the viewport, mounted
 * once in the root layout (not per-page) so it can never be missed on a new
 * route — a Phase 4 Cycle 2 UX review found it wired into the homepage only,
 * meaning all 32 new module/platform pages had no persistent mobile CTA at
 * all, a direct violation of docs/landing-redesign/phase-1/
 * conversion-architecture.md's "demo conversion must never require opening
 * the mobile nav menu" rule. See docs/landing-redesign/phase-4/decision-log.md.
 *
 * Hidden at `sm` (480px) and above, matching the header CTA's own `hidden
 * sm:block` breakpoint exactly — not `lg`. A Phase 6 investigation (real
 * screenshot + Playwright visibility check, not assumption) found the two
 * breakpoints previously didn't line up: this bar used `lg:hidden` (visible
 * up to 1024px) while the header CTA used `hidden sm:block` (visible from
 * 480px), so from 480-1023px BOTH rendered simultaneously — confirmed live
 * at 768px showing three "Book a Product Demo" prompts on screen at once
 * (hero CTA, header CTA, sticky bar). Below 480px only this bar shows;
 * at 480px and above only the header CTA shows — a clean handoff, not a
 * gap. See docs/landing-redesign/phase-6/decision-log.md.
 *
 * Hidden on /book-demo* routes (the form or its confirmation is already the
 * page's entire purpose — a floating "Book a Product Demo" button while
 * someone is mid-form, or just finished, reads as broken rather than helpful).
 */
export function StickyMobileCta() {
  const pathname = usePathname();
  if (pathname?.startsWith("/book-demo")) return null;

  return (
    <div
      data-sticky-mobile-cta
      className="fixed inset-x-0 bottom-0 z-40 border-t border-(--color-border-default) bg-(--color-bg-elevated) p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-(--shadow-panel) sm:hidden"
    >
      <Link
        href="/book-demo"
        prefetch={false}
        onClick={() => track("sticky_mobile_cta_click", { ctaLocation: "sticky_mobile_bar", ctaDestination: "/book-demo" })}
        className="flex h-11 w-full items-center justify-center rounded-(--radius-control) bg-(--color-bg-brand) text-sm font-semibold text-(--color-text-inverse)"
      >
        Book a Product Demo
      </Link>
    </div>
  );
}
