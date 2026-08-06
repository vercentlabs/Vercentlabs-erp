import { SITE_IDENTITY } from "@vercentlabs/landing-content";

/**
 * NEXT_PUBLIC_SITE_URL should be set in every real deployment (see
 * apps/landing/.env.example). The localhost fallback only applies to local dev/build,
 * never to a shipped production artifact — it keeps `next build` from failing when
 * the variable is unset in this phase's validation environment.
 */
export const SITE_URL = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

/**
 * apps/web's own URL. Used both client-side (header/footer "Sign in" link,
 * which leaves this app) and server-only (lib/crm-capture.ts's lead-delivery
 * proxy target) — safe in both contexts since this is just a base URL, never
 * a secret.
 */
export const APP_URL = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001");

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

export const SITE = {
  ...SITE_IDENTITY,
  url: SITE_URL,
} as const;
