// Transactional auth mail used by the verify-email / reset-password /
// invitation flows.
import { WORKSPACE_EMAILS } from "@vercentlabs/config";

import { escapeHtml, getMailTransport, smtpConfiguration } from "../platform/mail/index.js";

const emailContent = {
  "verify-email": {
    subject: "Verify your email for Vercentlabs ERP",
    preheader: "One click to confirm your email and open your workspace.",
    heading: "Confirm your email address",
    introduction: "Thanks for signing up. Confirm this is your email address and your Vercentlabs ERP workspace is ready to use.",
    actionLabel: "Verify email address",
    notYou: "If you didn't create a Vercentlabs ERP account, you can ignore this email — no account is activated without this step.",
  },
  "reset-password": {
    subject: "Reset your Vercentlabs ERP password",
    preheader: "Use this secure link to choose a new password.",
    heading: "Reset your password",
    introduction: "We received a request to reset the password for your Vercentlabs ERP account. Choose a new one with the button below.",
    actionLabel: "Choose a new password",
    notYou: "If you didn't ask for this, you can ignore this email — your password stays the same.",
  },
  "confirm-email-change": {
    subject: "Confirm your new email for Vercentlabs ERP",
    preheader: "Confirm this address to sign in with it from now on.",
    heading: "Confirm your new email address",
    introduction: "You asked to sign in to Vercentlabs ERP with this email address from now on. Confirm it with the button below; until then your old address stays in use.",
    actionLabel: "Confirm new email",
    notYou: "If you didn't ask for this, ignore this email — nothing changes.",
  },
  // A notice with no link (a sign-in from a new device, a password or email change, MFA changes, an ownership transfer). The heading
  // and text come from the caller.
  "security-alert": {
    subject: "Security notice from Vercentlabs ERP",
    preheader: "A change was made to your Vercentlabs ERP account.",
    heading: "Security notice",
    introduction: "",
    actionLabel: "",
    notYou: "If this wasn't you, reset your password now from the sign-in page and contact your workspace owner.",
  },
  "organization-invitation": {
    subject: "You're invited to join a workspace on Vercentlabs ERP",
    preheader: "Accept the invitation to join your team's workspace.",
    heading: "You're invited to join your team",
    introduction: "You've been invited to collaborate in a Vercentlabs ERP workspace.",
    actionLabel: "Accept invitation",
    notYou: "If you weren't expecting this invitation, you can ignore this email.",
  },
};

// The brand palette, inline (email clients drop stylesheets): indigo for the brand and the action, slate for the text.
const C = { brand: "#4f46e5", brandSoft: "#eef2ff", ink: "#0f172a", body: "#334155", muted: "#64748b", faint: "#94a3b8", line: "#e2e8f0", canvas: "#f1f5f9", card: "#ffffff" };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Security templates below; the SMTP transport is the shared platform one
// (core/platform/mail). Security mail never consults notification preferences.
// input.expiresIn ("24 hours") is how long the link works, from where the link was made.
function createEmail(input) {
  const template = emailContent[input.type];
  // A security alert carries its own subject, heading and text; it has no link.
  const content = input.type === "security-alert"
    ? { ...template, subject: input.subject ?? template.subject, heading: input.heading ?? template.heading, introduction: input.message ?? "" }
    : template;
  const organization = input.organizationName ? escapeHtml(input.organizationName) : null;
  const expiry = input.expiresIn ? `This link works for ${input.expiresIn} and can be used once.` : "This link can be used once.";
  const support = WORKSPACE_EMAILS.support;
  const text = [
    content.heading,
    "",
    content.introduction + (input.organizationName ? ` Workspace: ${input.organizationName}.` : ""),
    "",
    ...(input.url ? [`${content.actionLabel}: ${input.url}`, "", expiry] : []),
    content.notYou,
    "",
    `Need help? ${support}`,
    "Vercentlabs LLP",
  ].join("\n");

  const url = input.url ? escapeHtml(input.url) : null;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(content.subject)}</title>
    <style>
      @media (max-width: 600px) {
        .card { padding: 28px 22px !important; }
        .button-link { display: block !important; text-align: center !important; }
        .heading { font-size: 22px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${C.canvas};font-family:${FONT};-webkit-font-smoothing:antialiased">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(content.preheader)}&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.canvas}">
      <tr>
        <td align="center" style="padding:32px 12px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px">
            <tr>
              <td style="padding:0 4px 20px">
                <table role="presentation" cellspacing="0" cellpadding="0"><tr>
                  <td style="width:32px;height:32px;background:${C.brand};border-radius:8px;color:#ffffff;font-size:16px;font-weight:700;text-align:center;line-height:32px">V</td>
                  <td style="padding-left:10px;color:${C.ink};font-size:15px;font-weight:700">Vercentlabs ERP</td>
                </tr></table>
              </td>
            </tr>
            <tr>
              <td class="card" style="background:${C.card};border:1px solid ${C.line};border-radius:16px;padding:36px 36px 32px">
                <h1 class="heading" style="margin:0 0 12px;color:${C.ink};font-size:24px;line-height:1.3;font-weight:700">${escapeHtml(content.heading)}</h1>
                <p style="margin:0 0 ${organization ? "16" : "28"}px;color:${C.body};font-size:15px;line-height:1.65">${escapeHtml(content.introduction)}</p>
                ${organization ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px"><tr>
                  <td style="background:${C.brandSoft};border-radius:10px;padding:12px 16px;color:${C.ink};font-size:14px">Workspace <strong style="display:block;margin-top:2px;font-size:16px">${organization}</strong></td>
                </tr></table>` : ""}
                ${url ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px"><tr>
                  <td align="left">
                    <a class="button-link" href="${url}" style="display:inline-block;padding:14px 28px;background:${C.brand};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px">${escapeHtml(content.actionLabel)}</a>
                  </td>
                </tr></table>
                <p style="margin:0 0 28px;color:${C.muted};font-size:13px;line-height:1.6">${escapeHtml(expiry)}</p>
                <p style="margin:0 0 8px;color:${C.muted};font-size:13px;line-height:1.6">Button not working? Paste this link into your browser:</p>
                <p style="margin:0 0 28px;padding:10px 12px;background:${C.canvas};border-radius:8px;word-break:break-all;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.5"><a href="${url}" style="color:${C.brand};text-decoration:none">${url}</a></p>` : ""}
                <p style="margin:0;padding-top:20px;border-top:1px solid ${C.line};color:${C.muted};font-size:13px;line-height:1.6">${escapeHtml(content.notYou)}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 8px 0;color:${C.faint};font-size:12px;line-height:1.7">
                Need help? <a href="mailto:${support}" style="color:${C.muted};text-decoration:underline">${support}</a><br />
                Vercentlabs LLP &middot; This is a security email; please don't forward it.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

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
