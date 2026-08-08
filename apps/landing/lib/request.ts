import { isIP } from "node:net";

/**
 * A real, REPRODUCED vulnerability found in Phase 8's Cycle 2 security
 * review: the previous implementation unconditionally trusted the
 * client-supplied `x-forwarded-for` header (`request.headers.get(...)` is
 * whatever the HTTP client sent — including a direct, unproxied attacker),
 * making the rate limiter on /api/book-demo trivially bypassable by sending
 * a different spoofed X-Forwarded-For value on every request. Confirmed live:
 * 6 requests each with a distinct spoofed header never tripped the limit,
 * while 6 unspoofed requests did on attempt 4.
 *
 * Fixed by adopting the exact same secure-by-default pattern already
 * established in apps/web/src/lib/security.ts's clientIp(): trust NO
 * client-suppliable header unless a specific one is explicitly configured
 * via TRUSTED_PROXY_IP_HEADER (set only when requests always pass through a
 * known, trusted reverse proxy that overwrites that header itself — the same
 * env var name and semantics apps/web already documents in its own
 * .env.example). Until that's configured for a real deployment, every
 * request rate-limits into the same "unavailable" bucket rather than
 * trusting a value an attacker fully controls.
 */
export function clientIp(request: Request): string {
  const configuredHeader = process.env.TRUSTED_PROXY_IP_HEADER?.trim().toLowerCase();
  if (!configuredHeader) {
    return process.env.NODE_ENV === "production" ? "unavailable" : "local";
  }

  const rawValue = request.headers.get(configuredHeader);
  if (!rawValue) return "unavailable";

  const index = Math.max(0, Number.parseInt(process.env.TRUSTED_PROXY_CLIENT_INDEX || "0", 10) || 0);
  const candidate = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[index];

  return candidate && isIP(candidate) ? candidate : "unavailable";
}

/** A short, non-guessable id for correlating a submission across client logs, server logs, and support. */
export function generateRequestId(): string {
  return crypto.randomUUID();
}
