"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ANNOUNCEMENT_BANNER } from "@vercentlabs/landing-content";
import { track } from "@/lib/analytics";

const STORAGE_KEY = `vercentlabs_announcement_dismissed_${ANNOUNCEMENT_BANNER.id}`;

export function AnnouncementBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
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
    <div className="grid min-h-9 grid-cols-[1fr_auto] items-center border-b border-(--color-border-strong) bg-(--vl-night) px-3 text-white sm:px-5">
      <p className="px-2 py-2 text-center text-xs font-semibold text-white/82 sm:text-sm">
        {ANNOUNCEMENT_BANNER.message}{" "}
        <Link
          href={ANNOUNCEMENT_BANNER.href}
          prefetch={false}
          onClick={() => track("announcement_banner_cta_click", { ctaLocation: "announcement_banner", ctaDestination: ANNOUNCEMENT_BANNER.href })}
          className="vl-editorial-link ml-1 text-white"
        >
          {ANNOUNCEMENT_BANNER.ctaLabel}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="flex h-8 w-8 items-center justify-center border-l border-white/15 text-white/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
