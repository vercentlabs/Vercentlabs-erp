"use client";

import Link from "next/link";
import { useState } from "react";

export default function AnnouncementBar() {
  const [visible, setVisible] = useState(true);

  if (!visible) {
    return null;
  }

  return (
    <div className="relative z-[60] bg-gradient-to-r from-indigo-800 via-indigo-700 to-violet-700 px-10 py-2 text-center text-[11px] font-semibold leading-4 text-white sm:px-12 sm:py-2.5 sm:text-sm sm:leading-5">
      <span>One connected ERP with 12 operational modules.</span>{" "}
      <Link
        href="/modules"
        className="font-extrabold underline decoration-white/50 underline-offset-4 hover:decoration-white"
      >
        Explore every module
      </Link>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss announcement"
        className="absolute right-0.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-1 sm:h-11 sm:w-11"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 2l10 10M12 2L2 12"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
