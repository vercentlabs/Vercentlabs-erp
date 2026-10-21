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
  // The 6-digit code (signup, sign-in, confirming it's you). Subject, heading and text are built from the code (see createEmail).
  "sign-in-code": {
    subject: "Your Vercentlabs code",
    preheader: "Your 6-digit code.",
    heading: "Your Vercentlabs code",
    introduction: "",
    actionLabel: "",
    notYou: "If you didn't ask for this, you can ignore this email.",
  },
  // Sign-in was asked for an email with no workspace: never "not found", an invitation to set one up instead.
  "sign-in-no-account": {
    subject: "Set up your Vercentlabs workspace",
    preheader: "There's no workspace for this email yet. Setting one up takes about a minute.",
    heading: "Let's set up your workspace",
    introduction: "We got a request to sign in with this email address, but there's no Vercentlabs workspace for it yet. Setting one up takes about a minute, and there's no password to remember.",
    steps: ["Tell us your name and your company", "Confirm with a 6-digit code we email you", "Pick the apps you need, and you're in"],
    actionLabel: "Set up your workspace",
    // /register is an ordinary address, not a one-time link.
    reusableLink: true,
    note: "Already use Vercentlabs with another email? Sign in with that address instead.",
    // The words of the note that link to the sign-in page (the register address with /login in place of /register).
    noteLink: { words: "Sign in with that address", from: /\/register$/, to: "/login" },
    notYou: "Didn't try to sign in? Someone may have typed your address by mistake. You can ignore this email; nothing is created.",
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

// The palette, inline (email clients drop stylesheets): the app's indigo for the brand and the action, in a light frame after Stripe's
// (awesome-design-md): navy ink, blue-grey body text, a soft blue-white canvas and hairline borders.
const C = { brand: "#4f46e5", brandSoft: "#eef2ff", ink: "#0d253d", body: "#425466", muted: "#64748d", faint: "#8792a2", line: "#e3e8ee", canvas: "#f6f9fc", card: "#ffffff" };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Security templates below; the SMTP transport is the shared platform one
// (core/platform/mail). Security mail never consults notification preferences.
// input.expiresIn ("24 hours") is how long the link works, from where the link was made.
function createEmail(input) {
  const template = emailContent[input.type];
  // A security alert carries its own subject, heading and text; it has no link.
  const verb = { signup: "set up your workspace", sign_in: "sign in", reauth: "confirm it's you" }[input.purpose] ?? "sign in";
  const content = input.type === "security-alert"
    ? { ...template, subject: input.subject ?? template.subject, heading: input.heading ?? template.heading, introduction: input.message ?? "" }
    : input.type === "sign-in-code"
      ? { ...template, subject: `${input.code} is your Vercentlabs code`,
        introduction: `Hi ${input.firstName || "there"}, your code to ${verb} is ${input.code}. It works for ${input.expiresIn ?? "10 minutes"}.` }
      : input.type === "organization-invitation" && input.inviterName
        ? { ...template, subject: `${input.inviterName} invited you to ${input.organizationName}`, heading: `Join ${input.organizationName}`,
          introduction: `${input.inviterFullName ?? input.inviterName} has invited you to join ${input.organizationName} on Vercentlabs.${input.apps?.length ? ` You'll have access to ${input.apps.join(" and ")}.` : ""}${input.note ? ` "${input.note}"` : ""}`,
          actionLabel: "Join workspace" }
        : template;
  const organization = input.organizationName ? escapeHtml(input.organizationName) : null;
  const expiry = template.reusableLink ? null : input.expiresIn ? `This link works for ${input.expiresIn} and can be used once.` : "This link can be used once.";
  // Which address the email is about, when the reader needs to know (a sign-in asked for an email with no workspace).
  const forEmail = input.type === "sign-in-no-account" && input.email ? escapeHtml(input.email) : null;
  const steps = content.steps ?? [];
  const noteUrl = content.noteLink && input.url ? escapeHtml(input.url.replace(content.noteLink.from, content.noteLink.to)) : null;
  const noteHtml = content.note
    ? noteUrl ? escapeHtml(content.note).replace(content.noteLink.words, `<a href="${noteUrl}" style="color:${C.brand};text-decoration:none;font-weight:500">${content.noteLink.words}</a>`) : escapeHtml(content.note)
    : null;
  const code = input.type === "sign-in-code" && input.code ? escapeHtml(input.code) : null;
  const support = WORKSPACE_EMAILS.support;
  const text = [
    content.heading,
    "",
    content.introduction + (input.organizationName ? ` Workspace: ${input.organizationName}.` : ""),
    ...(forEmail ? ["", `Email: ${input.email}`] : []),
    ...(steps.length ? ["", ...steps.map((step, index) => `${index + 1}. ${step}`)] : []),
    "",
    ...(input.url ? [`${content.actionLabel}: ${input.url}`, "", ...(expiry ? [expiry] : [])] : []),
    ...(content.note ? [content.note, ""] : []),
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
        <td align="center" style="padding:40px 12px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px">
            <tr>
              <td style="padding:0 4px 24px">
                <table role="presentation" cellspacing="0" cellpadding="0"><tr>
                  <td style="width:28px;height:28px;background:${C.brand};border-radius:7px;color:#ffffff;font-size:14px;font-weight:700;text-align:center;line-height:28px">V</td>
                  <td style="padding-left:10px;color:${C.ink};font-size:15px;font-weight:600;letter-spacing:-0.2px">Vercentlabs</td>
                </tr></table>
              </td>
            </tr>
            <tr>
              <td class="card" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;padding:40px;box-shadow:0 2px 5px rgba(50,50,93,0.06),0 1px 1px rgba(0,0,0,0.04)">
                <h1 class="heading" style="margin:0 0 14px;color:${C.ink};font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-0.5px">${escapeHtml(content.heading)}</h1>
                <p style="margin:0 0 ${organization || code || forEmail || steps.length ? "20" : "28"}px;color:${C.body};font-size:15px;line-height:1.6">${escapeHtml(content.introduction)}</p>
                ${forEmail ? `<p style="margin:0 0 24px"><span style="display:inline-block;padding:6px 12px;background:${C.canvas};border:1px solid ${C.line};border-radius:999px;color:${C.ink};font-size:13px;font-weight:500">${forEmail}</span></p>` : ""}
                ${steps.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px">${steps.map((step, index) => `<tr>
                  <td width="28" valign="top" style="padding:0 0 10px"><span style="display:inline-block;width:22px;height:22px;background:${C.brandSoft};border-radius:999px;color:${C.brand};font-size:12px;font-weight:600;line-height:22px;text-align:center">${index + 1}</span></td>
                  <td valign="top" style="padding:2px 0 10px 6px;color:${C.body};font-size:14px;line-height:1.5">${escapeHtml(step)}</td>
                </tr>`).join("")}</table>` : ""}
                ${code ? `<p style="margin:0 0 28px;padding:16px;background:${C.canvas};border:1px solid ${C.line};border-radius:10px;color:${C.ink};font-size:32px;font-weight:600;letter-spacing:10px;text-align:center;font-family:Menlo,Consolas,monospace">${code}</p>` : ""}
                ${organization ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px"><tr>
                  <td style="background:${C.canvas};border:1px solid ${C.line};border-radius:10px;padding:12px 16px;color:${C.muted};font-size:13px">Workspace <strong style="display:block;margin-top:2px;color:${C.ink};font-size:16px;font-weight:600">${organization}</strong></td>
                </tr></table>` : ""}
                ${url ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 ${expiry ? "14" : "24"}px"><tr>
                  <td style="border-radius:8px;background:${C.brand}">
                    <a class="button-link" href="${url}" style="display:inline-block;padding:13px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px">${escapeHtml(content.actionLabel)} &rarr;</a>
                  </td>
                </tr></table>
                ${expiry ? `<p style="margin:0 0 24px;color:${C.muted};font-size:13px;line-height:1.6">${escapeHtml(expiry)}</p>` : ""}` : ""}
                ${noteHtml ? `<p style="margin:0 0 24px;color:${C.body};font-size:14px;line-height:1.6">${noteHtml}</p>` : ""}
                <p style="margin:0;padding-top:20px;border-top:1px solid ${C.line};color:${C.muted};font-size:13px;line-height:1.6">${escapeHtml(content.notYou)}</p>
                ${url ? `<p style="margin:16px 0 0;color:${C.faint};font-size:12px;line-height:1.6">Button not working? Copy this address into your browser:<br /><a href="${url}" style="color:${C.brand};text-decoration:none;word-break:break-all">${url}</a></p>` : ""}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 8px 0;color:${C.faint};font-size:12px;line-height:1.7">
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
