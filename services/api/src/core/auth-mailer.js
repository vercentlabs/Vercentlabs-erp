// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// core/mailer.ts (TS -> JS syntax only; unchanged logic). Needed directly
// by Phase 4's verify-email / reset-password / invitation flows.
import { WORKSPACE_EMAILS } from "@vercentlabs/config";

import { escapeHtml, getMailTransport, smtpConfiguration } from "./platform/mail/index.js";

const emailContent = {
  "verify-email": {
    subject: "Verify your Vercentlabs ERP account",
    heading: "Verify your email address",
    introduction: "Confirm your email address to activate your Vercentlabs ERP account.",
    actionLabel: "Verify email",
  },
  "reset-password": {
    subject: "Reset your Vercentlabs ERP password",
    heading: "Reset your password",
    introduction: "Use the secure link below to choose a new password.",
    actionLabel: "Reset password",
  },
  "organization-invitation": {
    subject: "You have been invited to Vercentlabs ERP",
    heading: "Join your organisation",
    introduction: "You have been invited to collaborate in Vercentlabs ERP.",
    actionLabel: "Accept invitation",
  },
};

// Security templates below; the SMTP transport is the shared platform one
// (core/platform/mail). Security mail never consults notification preferences.
function createEmail(input) {
  const content = emailContent[input.type];
  const organizationText = input.organizationName ? ` Organisation: ${input.organizationName}.` : "";
  const text = [
    content.heading,
    "",
    content.introduction + organizationText,
    "",
    input.url,
    "",
    "This security link may expire and should not be shared.",
    "",
    "Vercentlabs LLP",
  ].join("\n");

  const organizationHtml = input.organizationName
    ? `<p style="margin:0 0 18px;color:#475569">Organisation: <strong>${escapeHtml(input.organizationName)}</strong></p>`
    : "";

  const html = `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="padding:40px 16px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px">
                <tr>
                  <td style="padding:36px">
                    <p style="margin:0 0 20px;color:#4f46e5;font-size:13px;font-weight:700;letter-spacing:1.5px">VERCENTLABS ERP</p>
                    <h1 style="margin:0 0 16px;color:#0f172a;font-size:28px;line-height:1.25">${escapeHtml(content.heading)}</h1>
                    <p style="margin:0 0 18px;color:#475569;font-size:16px;line-height:1.7">${escapeHtml(content.introduction)}</p>
                    ${organizationHtml}
                    <p style="margin:28px 0">
                      <a href="${escapeHtml(input.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">${escapeHtml(content.actionLabel)}</a>
                    </p>
                    <p style="margin:24px 0 8px;color:#64748b;font-size:13px;line-height:1.6">When the button does not work, copy this address:</p>
                    <p style="margin:0;word-break:break-all;color:#4f46e5;font-size:13px;line-height:1.6">${escapeHtml(input.url)}</p>
                    <hr style="margin:30px 0;border:0;border-top:1px solid #e2e8f0" />
                    <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6">This security link should not be shared. Vercentlabs LLP &middot; Enterprise software platform</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return { subject: content.subject, text, html };
}

async function deliverWithSmtp(input, env) {
  const smtp = getMailTransport(env);
  if (!smtp) return false;
  const content = createEmail(input);
  await smtp.transporter.sendMail({
    from: smtp.from,
    replyTo: smtp.replyTo,
    to: input.email,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
  return true;
}

async function deliverWithWebhook(input, env) {
  const webhookUrl = env.AUTH_EMAIL_WEBHOOK_URL?.trim();
  if (!webhookUrl) return false;
  const timeout = Math.max(1000, Number(env.AUTH_EMAIL_TIMEOUT_MS || "8000"));
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.AUTH_EMAIL_WEBHOOK_SECRET ? { Authorization: `Bearer ${env.AUTH_EMAIL_WEBHOOK_SECRET}` } : {}),
    },
    body: JSON.stringify({
      source: "vercentlabs-erp-web",
      sentAt: new Date().toISOString(),
      replyTo: env.AUTH_EMAIL_REPLY_TO?.trim() || WORKSPACE_EMAILS.support,
      ...input,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`Authentication email webhook failed (${response.status}).`);
  return true;
}

export async function deliverAuthMessage(input, env = process.env) {
  const deliveredWithSmtp = await deliverWithSmtp(input, env);
  if (deliveredWithSmtp) return true;
  return deliverWithWebhook(input, env);
}

// A deployment-wide fact (is ANY transport configured at all), not a
// per-request delivery outcome — safe to expose on public/anonymous
// endpoints (forgot-password) without leaking whether a specific email is
// registered, since it's identical for every caller regardless of the
// target address.
export function isAuthMailerConfigured(env = process.env) {
  return Boolean(smtpConfiguration(env)) || Boolean(env.AUTH_EMAIL_WEBHOOK_URL?.trim());
}
