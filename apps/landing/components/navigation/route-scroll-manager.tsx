"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Next.js normally scrolls a newly selected route to its first visible page
 * element. With this site's persistent sticky header and long editorial
 * sections, that heuristic can retain a mid-page offset from the previous
 * route. Explicitly reset forward link navigations while allowing the browser
 * to restore the saved position for Back/Forward history traversal.
 */
export function RouteScrollManager() {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const restoringHistory = useRef(false);

  useEffect(() => {
    function handlePopState() {
      restoringHistory.current = true;
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (pathname === previousPathname.current) return;
    previousPathname.current = pathname;

    if (restoringHistory.current) {
      restoringHistory.current = false;
      return;
    }

    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
