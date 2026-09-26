// Automated verification never depends on a live mail server: SMTP and the
// auth-mail webhook are blanked so deliverAuthMessage reports "not
// delivered" (the tests assert database state), unless an explicit, opt-in
// smoke run sets LIVE_SMTP_SMOKE=1 (never on pull requests).
export const OFFLINE_MAIL_KEYS = Object.freeze(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_SECURE", "AUTH_EMAIL_FROM", "AUTH_EMAIL_WEBHOOK_URL", "AUTH_EMAIL_WEBHOOK_SECRET"]);

export function applyOfflineMail(env = process.env) {
  if (env.LIVE_SMTP_SMOKE === "1") return env;
  for (const key of OFFLINE_MAIL_KEYS) env[key] = "";
  return env;
}
