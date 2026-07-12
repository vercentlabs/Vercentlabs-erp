"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const storageKey = "vercent_enterprise_bar_dismissed_v1";

export default function AnnouncementBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem(storageKey);

    queueMicrotask(() => {
      if (!dismissed) {
        setVisible(true);
      }
    });
  }, []);

  function dismiss() {
    sessionStorage.setItem(storageKey, "1");
    setVisible(false);
  }

  if (!visible) {
    return null;
  }

  return (
    <div
      role="banner"
      aria-label="Product announcement"
      className="announcement-shimmer relative z-50 overflow-hidden px-10 py-2.5 text-center text-sm text-white sm:px-12"
      style={{
        background:
          "linear-gradient(90deg, #312e81 0%, #4338ca 35%, #4f46e5 60%, #6d28d9 100%)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)",
        }}
      />

      <span
        className="relative mr-2 hidden items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider sm:inline-flex"
        style={{
          background: "rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.25)",
        }}
      >
        <span className="live-dot" aria-hidden="true" />
        Building
      </span>

      <span className="relative">
        VercentLabs is building one connected enterprise ERP platform.
        <Link
          href="#platform-preview"
          className="ml-1 font-bold underline underline-offset-2 hover:no-underline focus-visible:outline-white"
        >
          Explore the preview {"->"}
        </Link>
      </span>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-white"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 2l8 8M10 2l-8 8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
