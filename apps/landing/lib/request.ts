import { isIP } from "node:net";

/**
 * Client IP for rate limiting, secure by default. A client-supplied header
 * such as `x-forwarded-for` is whatever the HTTP client sent — trusting it
 * unconditionally lets anyone bypass the /api/book-demo rate limit by
 * spoofing a new value on every request.
 *
 * So NO client-suppliable header is trusted unless one is explicitly
 * configured via TRUSTED_PROXY_IP_HEADER (set only when requests always pass
 * through a known, trusted reverse proxy that overwrites that header itself —
 * the same env var name and semantics as apps/web's .env.example). Until
 * that's configured, every request rate-limits into the same "unavailable"
 * bucket rather than trusting a value an attacker fully controls.
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
