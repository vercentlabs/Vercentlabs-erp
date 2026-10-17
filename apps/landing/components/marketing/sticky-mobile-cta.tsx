"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics";

export function StickyMobileCta() {
  const pathname = usePathname();
  if (pathname?.startsWith("/book-demo")) return null;

  return (
    <div
      data-sticky-mobile-cta
      className="fixed inset-x-0 bottom-0 z-40 border-t border-(--color-border-strong) bg-(--color-bg-elevated) px-3 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] shadow-[0_-10px_30px_rgba(23,24,23,.08)] sm:hidden"
    >
      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <div className="min-w-0">
          <p className="text-[0.61rem] font-bold uppercase tracking-[0.12em] text-(--color-text-muted)">See it on your workflow</p>
          <p className="truncate text-xs font-semibold text-(--color-text-primary)">30-minute working session</p>
        </div>
        <Link
          href="/book-demo"
          prefetch={false}
          onClick={() => track("sticky_mobile_cta_click", { ctaLocation: "sticky_mobile_bar", ctaDestination: "/book-demo" })}
          className="flex min-h-10 items-center justify-center rounded-[3px] border border-(--color-bg-brand) bg-(--color-bg-brand) px-4 text-xs font-bold text-white"
        >
          Book a Demo
        </Link>
      </div>
    </div>
  );
}
