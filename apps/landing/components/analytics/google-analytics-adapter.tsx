"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  clearQueuedAnalytics,
  installAnalyticsSink,
  type AnalyticsEventName,
  type SafeAnalyticsProperties,
} from "@/lib/analytics";

const GA_MEASUREMENT_ID = "G-1378276DJK";
const CONSENT_KEY = "vercentlabs_ga4_consent_v1";

type ConsentChoice = "granted" | "denied" | null;
type GtagArgs = [string, ...unknown[]];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: GtagArgs) => void;
  }
}

function readConsent(): ConsentChoice {
  try {
    const stored = window.localStorage.getItem(CONSENT_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch {
    return null;
  }
}

function persistConsent(choice: Exclude<ConsentChoice, null>) {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // If storage is unavailable, the choice simply lasts for this page load.
  }
}

function subscribeToConsent() {
  return () => {};
}

function getMountedSnapshot() {
  return true;
}

function getServerMountedSnapshot() {
  return false;
}

function toGaParameters(properties?: SafeAnalyticsProperties): Record<string, string | number> {
  if (!properties) return {};

  const result: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== "string" && typeof value !== "number") continue;

    const snakeCaseKey = key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
    result[snakeCaseKey] = value;
  }

  return result;
}

function prepareGtag() {
  window.dataLayer = window.dataLayer ?? [];

  window.gtag =
    window.gtag ??
    ((...args: GtagArgs) => {
      window.dataLayer?.push(args);
    });
}

function loadGoogleAnalytics() {
  prepareGtag();

  window.gtag?.("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  window.gtag?.("consent", "update", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  window.gtag?.("js", new Date());

  window.gtag?.("config", GA_MEASUREMENT_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  if (!document.querySelector(`script[data-vercentlabs-ga4="${GA_MEASUREMENT_ID}"]`)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    script.dataset.vercentlabsGa4 = GA_MEASUREMENT_ID;
    document.head.appendChild(script);
  }

  installAnalyticsSink((event: AnalyticsEventName, properties?: SafeAnalyticsProperties) => {
    window.gtag?.("event", event, toGaParameters(properties));
  });
}

export function GoogleAnalyticsAdapter() {
  const mounted = useSyncExternalStore(
    subscribeToConsent,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );
  const storedConsent = useSyncExternalStore(subscribeToConsent, readConsent, () => null);
  const [selectedConsent, setSelectedConsent] = useState<ConsentChoice>(null);
  const consent = selectedConsent ?? storedConsent;

  useEffect(() => {
    if (consent === "granted") {
      loadGoogleAnalytics();
    } else if (consent === "denied") {
      clearQueuedAnalytics();
    }
  }, [consent]);

  if (!mounted || consent !== null) {
    return null;
  }

  return (
    <aside
      aria-label="Analytics preference"
      className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-[760px] border border-(--color-border-strong) bg-(--color-bg-page) p-4 shadow-lg sm:inset-x-5 sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <p className="text-sm font-semibold text-(--color-text-primary)">
            Help us improve Vercentlabs
          </p>
          <p className="mt-1 text-xs leading-5 text-(--color-text-secondary)">
            Allow privacy-conscious analytics so we can understand which pages,
            ERP modules and workflows are useful. Advertising and personalization
            remain disabled.
          </p>
          <a
            href="/privacy"
            className="mt-2 inline-block text-xs font-semibold text-(--color-text-brand) underline underline-offset-4"
          >
            Privacy policy
          </a>
        </div>

        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button
            type="button"
            className="min-h-10 border border-(--color-border-strong) px-4 text-xs font-semibold text-(--color-text-primary)"
            onClick={() => {
              persistConsent("denied");
              setSelectedConsent("denied");
            }}
          >
            Essential only
          </button>

          <button
            type="button"
            className="min-h-10 border border-(--vl-ink) bg-(--vl-ink) px-4 text-xs font-semibold text-white"
            onClick={() => {
              persistConsent("granted");
              setSelectedConsent("granted");
            }}
          >
            Allow analytics
          </button>
        </div>
      </div>
    </aside>
  );
}
