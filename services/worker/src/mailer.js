import nodemailer from "nodemailer";

// Prompt 6 (F016): real SMTP email delivery for the worker process. Reuses
// the exact same env-var contract as apps/web/src/core/mailer.ts (SMTP_HOST/
// SMTP_USER/SMTP_PASSWORD/AUTH_EMAIL_FROM) rather than inventing a second
// set of configuration — ops configures SMTP once. The two mailers are
// separate modules (not a shared package) because they live in different
// deployable services (apps/web vs services/worker) with no existing
// cross-service import path; duplicating this ~20-line transport setup was
// judged simpler and lower-risk than introducing a new shared package or an
// internal worker->web HTTP call purely to reuse one function.
let transporter = null;

function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  if (!host && !user && !password && !from) return null;
  if (!host || !user || !password || !from) {
    throw new Error("SMTP configuration is incomplete. SMTP_HOST, SMTP_USER, SMTP_PASSWORD and AUTH_EMAIL_FROM are required.");
  }
  const port = Number(process.env.SMTP_PORT || "465");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid network port.");
  }
  const secure = process.env.SMTP_SECURE?.toLowerCase() !== "false";
  return { host, port, secure, user, password, from };
}

function getTransporter() {
  const config = smtpConfig();
  if (!config) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      tls: { minVersion: "TLSv1.2" },
    });
  }
  return { transporter, from: config.from };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Sends a plain, real transactional email. Returns { sent: boolean } —
// `sent: false` (SMTP not configured in this environment) is a legitimate,
// honest outcome, never thrown as an error: the reminder-dispatch worker
// records this as the reminder's own delivery-failure reason rather than
// crashing the batch or pretending the email went out.
export async function sendTransactionalEmail({ to, subject, heading, body, actionLabel, actionUrl }) {
  const smtp = getTransporter();
  if (!smtp) return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  const text = [heading, "", body, actionUrl ? `\n${actionLabel || "Open"}: ${actionUrl}` : "", "", "Vercentlabs ERP"].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif">
    <table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #e2e8f0;border-radius:14px">
    <tr><td style="padding:28px">
      <p style="margin:0 0 16px;color:#4f46e5;font-size:12px;font-weight:700;letter-spacing:1.2px">VERCENTLABS ERP</p>
      <h1 style="margin:0 0 12px;color:#0f172a;font-size:22px">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6">${escapeHtml(body)}</p>
      ${actionUrl ? `<p style="margin:20px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">${escapeHtml(actionLabel || "Open")}</a></p>` : ""}
    </td></tr></table></td></tr></table></body></html>`;
  await smtp.transporter.sendMail({ from: smtp.from, to, subject, text, html });
  return { sent: true };
}
