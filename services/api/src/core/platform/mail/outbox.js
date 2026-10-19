// The delivery log and the mail queue (Shared Platform plan 4).
//   Every business email the apps send is logged (to whom, subject, how it went: sent / failed / bounced).
//   Security mail (verify email, password reset, invitations, security notices) is queued in the same transaction as the token it
//   carries and sent by the worker within seconds, with retries: 1, 2, 4 … minutes up to 6 hours, 8 attempts. A permanent refusal
//   (an SMTP 5xx: no such mailbox, rejected) marks the message bounced and is not retried. The queued content is envelope-encrypted
//   (it can hold a one-time link) and erased once sent or given up.
import { decryptSecret, encryptSecret } from "../secrets/index.js";

const MAX_ATTEMPTS = 8;
const backoffMinutes = (attempts) => Math.min(360, 2 ** Math.max(0, attempts - 1));
const permanent = (error) => {
  const code = Number(error?.responseCode ?? (/^\s*(\d{3})/.exec(String(error?.response ?? ""))?.[1] ?? NaN));
  return code >= 500 && code < 600;
};

export async function logMail(client, { organizationId = null, kind = "business", template = null, recipients, subject, status, via = null, messageId = null, error = null }) {
  await client.query(
    `INSERT INTO public.mail_log (organization_id, kind, template, recipients, subject, status, sent_via, attempts, message_id, last_error, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, CASE WHEN $6 = 'sent' THEN now() END)`,
    [organizationId, kind, template, [recipients].flat().filter(Boolean).map(String).slice(0, 50), String(subject ?? "").slice(0, 300), status, via, messageId, error ? String(error).slice(0, 500) : null]);
}

// Queues a security email (the input of deliverAuthMessage). Returns whether any mail transport is configured — the honest
// "it will be sent" answer callers give the person.
export async function queueSecurityMail(client, input, env = process.env) {
  const { isAuthMailerConfigured } = await import("../../auth/mailer.js");
  const configured = isAuthMailerConfigured(env);
  await client.query(
    `INSERT INTO public.mail_log (organization_id, kind, template, recipients, subject, status, next_attempt_at, encrypted_payload, last_error)
     VALUES ($1, 'security', $2, $3, $4, $5, now(), $6::jsonb, $7)`,
    [input.organizationId ?? null, input.type, [input.email], input.subject ?? input.type, configured ? "queued" : "not_configured",
      configured ? JSON.stringify(await encryptSecret(input, env)) : null, configured ? null : "No mail transport is configured."]);
  return configured;
}

// Queues a notification or digest email (business mail from the platform about the company's work).
export async function queueMail(client, input, env = process.env) {
  const { isAuthMailerConfigured } = await import("../../auth/mailer.js");
  const configured = isAuthMailerConfigured(env);
  await client.query(
    `INSERT INTO public.mail_log (organization_id, kind, template, recipients, subject, status, next_attempt_at, encrypted_payload, last_error)
     VALUES ($1, 'business', $2, $3, $4, $5, now(), $6::jsonb, $7)`,
    [input.organizationId ?? null, input.type, [input.email], String(input.subject ?? input.type).slice(0, 300), configured ? "queued" : "not_configured",
      configured ? JSON.stringify(await encryptSecret(input, env)) : null, configured ? null : "No mail transport is configured."]);
  return configured;
}

// Sends one queued message: notifications and digests as a plain business email, everything else through the security mailer.
export async function deliverQueuedMail(input, env = process.env) {
  if (input?.type === "notification" || input?.type === "digest") {
    const { getMailTransport, renderTransactionalEmail } = await import("./transport.js");
    const transport = getMailTransport(env);
    if (!transport) return false;
    const base = (env.APP_URL || "http://localhost:3001").replace(/\/$/, "");
    const body = input.type === "digest"
      ? (input.items ?? []).map((item) => `• ${item.title}${item.message ? ` — ${item.message}` : ""}`).join("\n")
      : input.message ?? "";
    const content = renderTransactionalEmail({
      heading: input.type === "digest" ? `What happened at ${input.organizationName ?? "your company"}` : input.title ?? "Notification",
      body, actionLabel: "Open Vercentlabs ERP", actionUrl: `${base}${input.type === "digest" ? "/notifications" : input.href ?? "/notifications"}`,
    });
    await transport.transporter.sendMail({ from: input.organizationName ? { name: `${input.organizationName} via Vercentlabs`, address: /<([^>]+)>/.exec(transport.from)?.[1] ?? transport.from } : transport.from,
      to: input.email, subject: input.subject, text: content.text, html: content.html });
    return true;
  }
  return (await import("../../auth/mailer.js")).deliverAuthMessage(input, env);
}

// The worker's pass: claims due messages (lease), sends each, records the outcome. `deliver(input, env)` defaults to
// deliverQueuedMail. Platform client (no tenant context: the log is a platform table).
export async function processMailQueue(client, { limit = 20, env = process.env, deliver = null } = {}) {
  const send = deliver ?? deliverQueuedMail;
  const claimed = (await client.query(
    `UPDATE public.mail_log SET status = 'sending', lease_expires_at = now() + interval '2 minutes', attempts = attempts + 1, updated_at = now()
      WHERE id IN (SELECT id FROM public.mail_log
                    WHERE (status = 'queued' AND next_attempt_at <= now()) OR (status = 'sending' AND lease_expires_at < now())
                    ORDER BY next_attempt_at NULLS FIRST LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id, attempts, encrypted_payload`, [limit])).rows;
  const outcome = { sent: 0, retry: 0, failed: 0, bounced: 0 };
  for (const message of claimed) {
    try {
      const input = await decryptSecret(message.encrypted_payload, env);
      const delivered = await send(input, env);
      if (!delivered) throw Object.assign(new Error("No mail transport is configured."), { notConfigured: true });
      await client.query(`UPDATE public.mail_log SET status = 'sent', sent_at = now(), encrypted_payload = NULL, last_error = NULL, lease_expires_at = NULL, sent_via = 'platform', updated_at = now() WHERE id = $1`, [message.id]);
      outcome.sent += 1;
    } catch (error) {
      const bounced = permanent(error);
      const giveUp = bounced || error?.notConfigured || Number(message.attempts) >= MAX_ATTEMPTS;
      await client.query(
        `UPDATE public.mail_log SET status = $2, last_error = $3, lease_expires_at = NULL, updated_at = now(),
                next_attempt_at = CASE WHEN $4::boolean THEN NULL ELSE now() + make_interval(mins => $5) END,
                encrypted_payload = CASE WHEN $4::boolean THEN NULL ELSE encrypted_payload END
          WHERE id = $1`,
        [message.id, bounced ? "bounced" : giveUp ? (error?.notConfigured ? "not_configured" : "failed") : "queued", String(error?.message ?? error).slice(0, 500), giveUp, backoffMinutes(Number(message.attempts))]);
      if (bounced) outcome.bounced += 1;
      else if (giveUp) outcome.failed += 1;
      else outcome.retry += 1;
    }
  }
  return outcome;
}

// Settings › Email › Delivery log: the company's recent mail, newest first.
export async function listMailLog(client, organizationId, { limit = 100, status = null } = {}) {
  return (await client.query(
    `SELECT id, kind, template, recipients, subject, status, sent_via, attempts, last_error, created_at, sent_at
       FROM public.mail_log WHERE organization_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT $3`,
    [organizationId, status, Math.min(500, Math.max(1, Number(limit) || 100))])).rows
    .map((row) => ({ id: row.id, kind: row.kind, template: row.template, recipients: row.recipients, subject: row.subject, status: row.status, via: row.sent_via,
      attempts: row.attempts, error: row.last_error, createdAt: row.created_at, sentAt: row.sent_at }));
}
