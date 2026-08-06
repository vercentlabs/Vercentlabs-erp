"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { track, type AnalyticsEventName, type SafeAnalyticsProperties } from "@/lib/analytics";

/**
 * Fires a `*_view` analytics event exactly once when its children scroll into
 * view (50% visible). No wrapper element is rendered beyond what's necessary
 * to attach the observer — the ref goes on a plain div with no layout impact
 * (display: contents) so this never changes page flow or spacing.
 */
export function TrackView({
  event,
  properties,
  children,
}: {
  event: AnalyticsEventName;
  properties?: SafeAnalyticsProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !firedRef.current) {
            firedRef.current = true;
            track(event, properties);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  return (
    <div ref={ref} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
