// The one outbound mail transport for every deployable (web app and worker).
// Configuration (set once): SMTP_HOST, SMTP_PORT (default 465), SMTP_SECURE
// (default true; false = STARTTLS required), SMTP_USER, SMTP_PASSWORD,
// AUTH_EMAIL_FROM, AUTH_EMAIL_REPLY_TO. TLS 1.2+, bounded timeouts.
//
// Security/auth mail (core/auth/mailer.js) and business transactional mail
// use different templates but this same transport. Mail is never governed by
// in-app notification preferences, and not every notification is emailable:
// a feature sends mail only where its own domain explicitly supports email.
import nodemailer from "nodemailer";
import { WORKSPACE_EMAILS } from "@vercentlabs/config";

let cached = null;
let cachedKey = null;
let testTransport = null;

// Tests capture outgoing mail instead of opening an SMTP connection.
export function setMailTransportForTests(transport) {
  testTransport = transport;
}

export function smtpConfiguration(env = process.env) {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.trim();
  const from = env.AUTH_EMAIL_FROM?.trim();
  const replyTo = env.AUTH_EMAIL_REPLY_TO?.trim() || WORKSPACE_EMAILS.support;
  if (!host && !user && !password && !from) return null;
  if (!host || !user || !password || !from) {
    throw new Error("SMTP configuration is incomplete. SMTP_HOST, SMTP_USER, SMTP_PASSWORD and AUTH_EMAIL_FROM are required.");
  }
  const port = Number(env.SMTP_PORT || "465");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT must be a valid network port.");
  const secure = env.SMTP_SECURE?.toLowerCase() !== "false";
  return { host, port, secure, user, password, from, replyTo };
}

export function getMailTransport(env = process.env) {
  if (testTransport) return { transporter: testTransport, from: env.AUTH_EMAIL_FROM || "Vercentlabs ERP <no-reply@example.test>", replyTo: env.AUTH_EMAIL_REPLY_TO || null };
  const configuration = smtpConfiguration(env);
  if (!configuration) return null;
  const key = `${configuration.host}|${configuration.port}|${configuration.secure}|${configuration.user}`;
  if (!cached || cachedKey !== key) {
    cached = nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      requireTLS: !configuration.secure,
      auth: { user: configuration.user, pass: configuration.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      tls: { minVersion: "TLSv1.2" },
    });
    cachedKey = key;
  }
  return { transporter: cached, from: configuration.from, replyTo: configuration.replyTo };
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Sends one message, optionally with CC recipients and attachments. `{ sent: false, reason: "SMTP_NOT_CONFIGURED" }` is an
 * honest outcome for an environment without mail, never a pretend send.
 */
// meter: { client, organizationId, idempotencyKey? } — a message a company's app sends to its customers or suppliers counts towards
// the plan's monthly messages (one per recipient), checked before it leaves (core/billing/usage.js). Sign-in and platform mail
// passes no meter and is never counted.
export async function sendMail({ to, cc, subject, text, html, replyTo, attachments, messageId, inReplyTo, references, fromName, headers, meter }, env = process.env) {
  const metered = Boolean(meter?.client && meter.organizationId);
  // A company's business mail goes through its own server or verified domain when it has one (core/platform/mail/company-sender.js).
  const transport = metered
    ? await (await import("./company-sender.js")).companyMailTransport(meter.client, meter.organizationId, env)
    : getMailTransport(env);
  if (!transport) {
    if (metered) await (await import("./outbox.js")).logMail(meter.client, { organizationId: meter.organizationId, recipients: [to, cc], subject, status: "not_configured", error: "No mail transport is configured." }).catch(() => undefined);
    return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  }
  if (metered) {
    const recipients = [to, cc].flat().filter(Boolean).length || 1;
    const { countOutboundMessages } = await import("../../billing/usage.js");
    await countOutboundMessages(meter.client, meter.organizationId, { quantity: recipients, channel: "email", idempotencyKey: meter.idempotencyKey ?? "" }, env);
  }
  // attachments: [{ filename, content (Buffer), contentType }] — a document a feature sends on purpose, such as a quotation PDF.
  // messageId / inReplyTo / references: a feature that threads replies (CRM email) sets its own message id and answers a known one.
  // fromName: the sender's name on the workspace's own address ("Ravi Rep via Acme <no-reply@…>"); the address itself never changes.
  const address = /<([^>]+)>/.exec(transport.from)?.[1] ?? transport.from;
  const name = fromName ?? transport.fromName ?? null;
  const from = name ? { name: String(name).replace(/["\r\n]/g, "").slice(0, 120), address } : transport.from;
  try {
    const info = await transport.transporter.sendMail({
      from, replyTo: replyTo ?? transport.replyTo ?? undefined, to, cc, subject, text, html, attachments,
      ...(messageId ? { messageId } : {}), ...(inReplyTo ? { inReplyTo } : {}), ...(references?.length ? { references } : {}),
      // headers: extra mail headers a feature needs, such as List-Unsubscribe on a campaign email
      ...(headers && typeof headers === "object" ? { headers } : {}),
      // A verified company domain signs its mail (DKIM), so receivers accept the company's own From address.
      ...(transport.dkim ? { dkim: transport.dkim } : {}),
    });
    if (metered) await (await import("./outbox.js")).logMail(meter.client, { organizationId: meter.organizationId, recipients: [to, cc], subject, status: "sent", via: transport.via ?? "platform", messageId: info?.messageId ?? null });
    return { sent: true, messageId: info?.messageId ?? messageId ?? null, via: transport.via ?? "platform" };
  } catch (error) {
    if (metered) {
      const code = Number(error?.responseCode ?? NaN);
      await (await import("./outbox.js")).logMail(meter.client, { organizationId: meter.organizationId, recipients: [to, cc], subject, status: code >= 500 && code < 600 ? "bounced" : "failed", via: transport.via ?? "platform", error: error?.message ?? error }).catch(() => undefined);
    }
    throw error;
  }
}

// Plain business transactional template: heading, body, optional action link.
// Every interpolated value is HTML-escaped; the text part mirrors it.
export function renderTransactionalEmail({ heading, body, actionLabel, actionUrl }) {
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
  return { text, html };
}

export async function sendTransactionalEmail({ to, subject, heading, body, actionLabel, actionUrl }, env = process.env) {
  const { text, html } = renderTransactionalEmail({ heading, body, actionLabel, actionUrl });
  return sendMail({ to, subject, text, html }, env);
}
