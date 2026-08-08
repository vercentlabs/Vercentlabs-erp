"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ANNOUNCEMENT_BANNER } from "@vercentlabs/landing-content";
import { track } from "@/lib/analytics";

const STORAGE_KEY = `vercentlabs_announcement_dismissed_${ANNOUNCEMENT_BANNER.id}`;

/**
 * Site-wide top announcement bar, mounted once above the header in the root
 * layout. Renders nothing on the server and during the initial client render
 * (so there's no hydration mismatch), then decides whether to show itself
 * from localStorage once mounted — dismissing it is remembered per browser,
 * keyed to ANNOUNCEMENT_BANNER.id so a future, different announcement isn't
 * silently suppressed by an old dismissal.
 */
export function AnnouncementBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Reads a browser-only value (localStorage) that's expected to legitimately
    // differ from the server-rendered default (hidden) once mounted — there's no
    // way to know the dismissal state during SSR or the initial hydration pass
    // without risking a real markup mismatch, so this can't be restructured into
    // a lazy useState initializer or useSyncExternalStore's server-snapshot path.
    const dismissed = window.localStorage.getItem(STORAGE_KEY) === "1";
    if (!dismissed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
      track("announcement_banner_view", { section: "announcement_banner" });
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
    track("announcement_banner_dismiss", { section: "announcement_banner" });
  }

  return (
    <div className="flex items-center justify-center gap-3 border-b border-(--color-border-default) bg-(--color-bg-brand) px-4 py-2.5 text-center">
      <p className="text-sm font-medium text-(--color-text-inverse)">
        {ANNOUNCEMENT_BANNER.message}{" "}
        <Link
          href={ANNOUNCEMENT_BANNER.href}
          prefetch={false}
          onClick={() => track("announcement_banner_cta_click", { ctaLocation: "announcement_banner", ctaDestination: ANNOUNCEMENT_BANNER.href })}
          className="font-semibold underline underline-offset-2 hover:no-underline"
        >
          {ANNOUNCEMENT_BANNER.ctaLabel}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="flex-none rounded-(--radius-control) p-1 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
