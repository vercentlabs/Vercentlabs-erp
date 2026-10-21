// Email codes (MVP 44): the 6-digit code that proves an email is the person's — for setting up a workspace, signing in, and confirming
// it's you before a sensitive change when you have no password. Only a hash of each code is kept. A code works for 10 minutes and for
// 5 wrong tries; a new code cancels the one before; a new code can be asked for after 30 seconds, and an email gets at most 5 codes an hour.
// The email carries the code in its subject line, so it can be read from the notification.
import { randomInt, timingSafeEqual } from "node:crypto";

import { isProductionRuntime } from "@vercentlabs/config";

import { queueSecurityMail } from "../platform/mail/outbox.js";
import { isAuthMailerConfigured } from "./mailer.js";
import { tokenHash } from "./session.js";

export const CODE_RULES = Object.freeze({ length: 6, minutes: 10, tries: 5, resendSeconds: 30, perHour: 5 });

export class EmailCodeError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.name = "EmailCodeError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

const MESSAGES = Object.freeze({
  wrong: [400, "That code is not right. Check the email and try again.", "AUTH_CODE_WRONG"],
  expired: [410, "This code has expired. We've sent you a new one.", "AUTH_CODE_EXPIRED"],
  locked: [429, "Too many wrong tries. Request a new code.", "AUTH_CODE_LOCKED"],
});
export function codeError(reason) {
  const [status, message, code] = MESSAGES[reason] ?? MESSAGES.wrong;
  return new EmailCodeError(status, message, code);
}
const normalize = (email) => String(email ?? "").trim().toLowerCase();
const hashOf = (email, purpose, code) => tokenHash(`${normalize(email)}|${purpose}|${code}`);

// mail: "code" (the code) or "no_account" (sign-in asked for an email with no workspace: an invitation to set one up, never "not found").
export async function issueEmailCode(client, { email, purpose, signupId = null, userId = null, firstName = null, mail = "code" }, env = process.env) {
  const address = normalize(email);
  const last = (await client.query(`SELECT created_at FROM public.email_codes WHERE lower(email) = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`, [address, purpose])).rows[0];
  if (last) {
    const wait = CODE_RULES.resendSeconds - Math.floor((Date.now() - new Date(last.created_at).getTime()) / 1000);
    if (wait > 0) throw new EmailCodeError(429, `You can ask for a new code in ${wait} seconds.`, "AUTH_CODE_TOO_SOON", { retryAfterSeconds: wait });
  }
  const sent = Number((await client.query(`SELECT count(*) AS n FROM public.email_codes WHERE lower(email) = $1 AND created_at > now() - interval '1 hour'`, [address])).rows[0].n);
  if (sent >= CODE_RULES.perHour) throw new EmailCodeError(429, "You've asked for too many codes. Try again in an hour.", "AUTH_CODE_LIMIT");
  await client.query(`UPDATE public.email_codes SET cancelled_at = now() WHERE lower(email) = $1 AND purpose = $2 AND consumed_at IS NULL AND cancelled_at IS NULL`, [address, purpose]);
  const code = String(randomInt(0, 10 ** CODE_RULES.length)).padStart(CODE_RULES.length, "0");
  await client.query(`INSERT INTO public.email_codes (email, purpose, code_hash, signup_id, user_id, expires_at) VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [address, purpose, hashOf(address, purpose, code), signupId, userId, String(CODE_RULES.minutes)]);
  const base = (env.APP_URL || "http://localhost:3001").replace(/\/$/, "");
  await queueSecurityMail(client, mail === "no_account"
    ? { type: "sign-in-no-account", email: address, url: `${base}/register` }
    : { type: "sign-in-code", email: address, code, purpose, firstName, expiresIn: `${CODE_RULES.minutes} minutes` }, env);
  // Without a mail transport (a developer's machine), the code is printed so the flow can still be used.
  if (!isAuthMailerConfigured(env) && !isProductionRuntime(env) && mail !== "no_account") console.info(`[dev] ${purpose} code for ${address}: ${code}`);
  return { resendAfterSeconds: CODE_RULES.resendSeconds, expiresInMinutes: CODE_RULES.minutes };
}

// Checks a code without throwing, so the caller can commit the counted try before it reports the outcome.
// Returns { ok: true, row } or { ok: false, reason: "wrong" | "expired" | "locked" }.
export async function checkEmailCode(client, { email, purpose, code }) {
  const address = normalize(email);
  const row = (await client.query(`SELECT * FROM public.email_codes WHERE lower(email) = $1 AND purpose = $2 AND consumed_at IS NULL AND cancelled_at IS NULL
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [address, purpose])).rows[0];
  if (!row) return { ok: false, reason: "wrong" };
  if (row.attempts >= CODE_RULES.tries) return { ok: false, reason: "locked" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired", row };
  const given = String(code ?? "").replace(/\D/g, "");
  const expected = Buffer.from(row.code_hash);
  const actual = Buffer.from(hashOf(address, purpose, given));
  if (given.length !== CODE_RULES.length || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    const attempts = row.attempts + 1;
    await client.query(`UPDATE public.email_codes SET attempts = $2 WHERE id = $1`, [row.id, attempts]);
    return { ok: false, reason: attempts >= CODE_RULES.tries ? "locked" : "wrong" };
  }
  await client.query(`UPDATE public.email_codes SET consumed_at = now() WHERE id = $1`, [row.id]);
  return { ok: true, row };
}

// Signups never finished (code never entered) are deleted after 24 hours; used and old codes after a day.
export async function pruneEmailCodes(client) {
  await client.query(`DELETE FROM public.signup_requests WHERE status <> 'completed' AND expires_at < now()`);
  await client.query(`DELETE FROM public.email_codes WHERE created_at < now() - interval '1 day'`);
}
