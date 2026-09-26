// Isolated E2E web servers never talk to a real mail server: SMTP is blanked
// (an empty value overrides the .env Next would load) and auth mail goes to
// the dev-only capture route, which tests can read back.
export function offlineMailEnv(baseUrl: string): Record<string, string> {
  return {
    SMTP_HOST: "",
    SMTP_PORT: "",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    AUTH_EMAIL_FROM: "",
    AUTH_EMAIL_CAPTURE_ENABLED: "1",
    AUTH_EMAIL_WEBHOOK_URL: `${baseUrl}/api/test-support/email-capture`,
    AUTH_EMAIL_WEBHOOK_SECRET: "",
  };
}
