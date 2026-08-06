"use client";

import { useEffect } from "react";
import { getAttribution } from "@/lib/attribution";
import { track } from "@/lib/analytics";

/** Mounted only on app/page.tsx — fires homepage_view once, with first-touch campaign context. */
export function HomepageViewTracker() {
  useEffect(() => {
    const attribution = getAttribution();
    track("homepage_view", {
      campaignSource: attribution?.utmSource,
      campaignMedium: attribution?.utmMedium,
      campaignName: attribution?.utmCampaign,
      referrerCategory: attribution?.referrerCategory,
    });
  }, []);

  return null;
}
