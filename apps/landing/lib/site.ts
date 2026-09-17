import { SITE_IDENTITY } from "@vercentlabs/landing-content";

/**
 * SITE_URL/APP_URL are imported at module scope by components/navigation/
 * header.tsx and components/layout/footer.tsx, which app/layout.tsx renders
 * on every single route — so a `new URL()` that throws here doesn't fail one
 * page, it 500s the entire site on every request (confirmed live: a
 * deployment with NEXT_PUBLIC_SITE_URL set to a bare domain like
 * "vercentlabs.com", missing its "https://" scheme, took down 100% of
 * traffic with a bare "Internal Server Error"). A single mistyped
 * hosting-panel env var must never be able to do that, so this parses
 * defensively — normalizing a missing scheme and falling back to a known-
 * good default (logged loudly, not silently) for anything still invalid —
 * rather than trusting operator input to already be a well-formed URL.
 */
function safeUrl(rawValue: string | undefined, fallback: string, label: string): URL {
  const trimmed = rawValue?.trim();
  if (!trimmed) return new URL(fallback);
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    console.error(
      `[lib/site.ts] ${label}="${rawValue}" is not a valid URL even after normalizing a missing scheme — falling back to ${fallback}. Fix this environment variable; every page is currently using the wrong URL for it.`,
    );
    return new URL(fallback);
  }
}

/**
 * NEXT_PUBLIC_SITE_URL should be set in every real deployment (see
 * apps/landing/.env.example). The localhost fallback only applies to local dev/build,
 * never to a shipped production artifact — it keeps `next build` from failing when
 * the variable is unset in this phase's validation environment.
 */
export const SITE_URL = safeUrl(process.env.NEXT_PUBLIC_SITE_URL, "http://localhost:3000", "NEXT_PUBLIC_SITE_URL");

/**
 * apps/web's own URL. Used both client-side (header/footer "Sign in" link,
 * which leaves this app) and server-only (lib/crm-capture.ts's lead-delivery
 * proxy target) — safe in both contexts since this is just a base URL, never
 * a secret.
 */
export const APP_URL = safeUrl(process.env.NEXT_PUBLIC_APP_URL, "http://localhost:3001", "NEXT_PUBLIC_APP_URL");

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

export const SITE = {
  ...SITE_IDENTITY,
  url: SITE_URL,
} as const;
