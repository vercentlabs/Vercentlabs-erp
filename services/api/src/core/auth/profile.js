// A person's own account (Shared Platform plan 3): their name, phone and preferences (time zone, language, date and number format),
// changing their password (with the current one, never one of the last five), changing their email (confirmed from the new
// address), and the security emails sent after any of these and after a sign-in from a new device.
import { createOpaqueToken, hashPassword, tokenHash, verifyPassword } from "./session.js";
import { CONFIRM_WITH_CODE, identityConfirmed } from "./code-sign-in.js";
import { passwordPolicyIssues } from "./password-policy.js";
import { deliverAuthMessage } from "./mailer.js";
import { queueSecurityMail } from "../platform/mail/outbox.js";
import { audit } from "../security/request-security.js";

export class ProfileError extends Error {
  constructor(status, message, code = "PROFILE_INVALID", details = undefined) {
    super(message);
    this.name = "ProfileError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const DATE_FORMATS = Object.freeze(["DD/MM/YYYY", "DD-MM-YYYY", "DD MMM YYYY", "YYYY-MM-DD", "MM/DD/YYYY"]);
export const NUMBER_FORMATS = Object.freeze(["indian", "international"]);
// The languages the screens can be read in: English only. A language saved earlier and since withdrawn reads as English.
export const LANGUAGES = Object.freeze([{ code: "en-IN", name: "English (India)" }]);
const PASSWORD_HISTORY = 5;
const EMAIL_CHANGE_TTL_HOURS = 24;
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key) && input[key] !== undefined;

// Security email (never blocked by notification preferences). With a client it is queued in the caller's transaction and sent by
// the worker with retries (core/platform/mail/outbox.js); without one it is sent at once.
export async function sendSecurityAlert(user, { subject, heading, message }, env = process.env, client = null) {
  if (!user?.email) return false;
  const input = { type: "security-alert", email: user.email, subject, heading, message };
  if (client) return queueSecurityMail(client, input, env);
  return deliverAuthMessage(input, env);
}

async function userRow(client, userId) {
  const row = (await client.query(`SELECT id, email, full_name, phone, password_hash, password_changed_at, mfa_enrolled_at FROM users WHERE id = $1`, [userId])).rows[0];
  if (!row) throw new ProfileError(404, "Your account was not found.", "PROFILE_NOT_FOUND");
  return row;
}

export async function getOwnProfile(client, session) {
  const user = await userRow(client, session.userId);
  const preference = (await client.query(
    `SELECT locale, timezone, date_format, number_format FROM user_preferences WHERE organization_id = $1 AND user_id = $2`, [session.organizationId, session.userId])).rows[0];
  const organization = (await client.query(`SELECT timezone FROM organizations WHERE id = $1`, [session.organizationId])).rows[0];
  const pending = (await client.query(
    `SELECT new_email, expires_at FROM email_change_requests WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [session.userId])).rows[0];
  return {
    fullName: user.full_name, email: user.email, phone: user.phone,
    locale: LANGUAGES.some((language) => language.code === preference?.locale) ? preference.locale : "en-IN", timezone: preference?.timezone ?? organization?.timezone ?? "Asia/Kolkata",
    timezoneIsCompany: !preference?.timezone, dateFormat: preference?.date_format ?? "DD/MM/YYYY", numberFormat: preference?.number_format ?? "indian",
    passwordChangedAt: user.password_changed_at, mfaEnrolled: Boolean(user.mfa_enrolled_at), hasPassword: Boolean(user.password_hash),
    pendingEmail: pending ? { email: pending.new_email, expiresAt: pending.expires_at } : null,
    options: { dateFormats: DATE_FORMATS, numberFormats: NUMBER_FORMATS, languages: LANGUAGES },
  };
}

export async function updateOwnProfile(client, session, input = {}) {
  const updates = [];
  const values = [session.userId];
  if (has(input, "fullName")) {
    const name = String(input.fullName).trim();
    if (!name || name.length > 200) throw new ProfileError(422, "Enter your name (up to 200 characters).", "PROFILE_INVALID", { field: "fullName" });
    values.push(name); updates.push(`full_name = $${values.length}`);
  }
  if (has(input, "phone")) {
    const phone = String(input.phone ?? "").trim() || null;
    if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw new ProfileError(422, "Enter a valid phone number.", "PROFILE_INVALID", { field: "phone" });
    values.push(phone); updates.push(`phone = $${values.length}`);
  }
  if (updates.length) await client.query(`UPDATE users SET ${updates.join(", ")}, updated_at = now() WHERE id = $1`, values);
  const preference = {};
  if (has(input, "timezone")) {
    const zone = input.timezone ? String(input.timezone).trim() : null;
    if (zone) { try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); } catch { throw new ProfileError(422, "Choose a valid time zone.", "PROFILE_INVALID", { field: "timezone" }); } }
    preference.timezone = zone;
  }
  if (has(input, "locale")) {
    if (!LANGUAGES.some((language) => language.code === input.locale)) throw new ProfileError(422, "Choose a language.", "PROFILE_INVALID", { field: "locale" });
    preference.locale = input.locale;
  }
  if (has(input, "dateFormat")) {
    if (!DATE_FORMATS.includes(input.dateFormat)) throw new ProfileError(422, "Choose a date format.", "PROFILE_INVALID", { field: "dateFormat" });
    preference.date_format = input.dateFormat;
  }
  if (has(input, "numberFormat")) {
    if (!NUMBER_FORMATS.includes(input.numberFormat)) throw new ProfileError(422, "Choose a number format.", "PROFILE_INVALID", { field: "numberFormat" });
    preference.number_format = input.numberFormat;
  }
  if (Object.keys(preference).length) {
    const columns = Object.keys(preference);
    await client.query(
      `INSERT INTO user_preferences (organization_id, user_id, ${columns.join(", ")}) VALUES ($1, $2, ${columns.map((_, index) => `$${index + 3}`).join(", ")})
       ON CONFLICT (organization_id, user_id) DO UPDATE SET ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}, updated_at = now()`,
      [session.organizationId, session.userId, ...columns.map((column) => preference[column])]);
  }
  return getOwnProfile(client, session);
}

// Change the password while signed in: the current password first; the new one passes the policy and is none of the last five.
// Every other session is signed out; this one stays.
// Someone without a password (signed up with an email code) sets their first one: no current password, a code to their email instead.
export async function changeOwnPassword(client, session, { currentPassword, newPassword } = {}, env = process.env) {
  const user = await userRow(client, session.userId);
  const confirmed = await identityConfirmed(client, { userId: session.userId, sessionId: session.sessionId, password: currentPassword });
  if (!confirmed.ok) {
    throw confirmed.needsCode ? new ProfileError(403, CONFIRM_WITH_CODE, "AUTH_REAUTH_REQUIRED")
      : new ProfileError(403, "The current password is not right.", "PROFILE_PASSWORD_WRONG", { field: "currentPassword" });
  }
  const issues = passwordPolicyIssues(String(newPassword ?? ""), { email: user.email });
  if (issues.length) throw new ProfileError(422, issues[0], "PROFILE_PASSWORD_POLICY", { field: "newPassword", issues });
  const previous = (await client.query(`SELECT password_hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [session.userId, PASSWORD_HISTORY])).rows;
  for (const stored of [user.password_hash, ...previous.map((row) => row.password_hash)]) {
    if (stored && (await verifyPassword(String(newPassword), stored))) {
      throw new ProfileError(422, `Choose a password you have not used before (the last ${PASSWORD_HISTORY} are not allowed).`, "PROFILE_PASSWORD_REUSED", { field: "newPassword" });
    }
  }
  if (user.password_hash) await client.query(`INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)`, [session.userId, user.password_hash]);
  await client.query(`DELETE FROM password_history WHERE user_id = $1 AND id NOT IN (SELECT id FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2)`, [session.userId, PASSWORD_HISTORY]);
  await client.query(`UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1`, [session.userId, await hashPassword(String(newPassword))]);
  const revoked = await client.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_changed' WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2) RETURNING id`, [session.userId, session.sessionId ?? null]);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "auth.password.changed", entityType: "user", entityId: session.userId, metadata: { otherSessionsSignedOut: revoked.rowCount } });
  await sendSecurityAlert(user, { subject: "Your Vercentlabs ERP password was changed", heading: "Your password was changed",
    message: `The password of your account was changed${revoked.rowCount ? ` and ${revoked.rowCount} other session${revoked.rowCount === 1 ? " was" : "s were"} signed out` : ""}.` }, env, client).catch(() => false);
  return { changed: true, otherSessionsSignedOut: revoked.rowCount };
}

// Start changing the email: the password confirms it is the person; a link goes to the NEW address and works for 24 hours.
export async function requestEmailChange(client, session, { newEmail, password } = {}, env = process.env) {
  const user = await userRow(client, session.userId);
  const confirmed = await identityConfirmed(client, { userId: session.userId, sessionId: session.sessionId, password });
  if (!confirmed.ok) throw confirmed.needsCode ? new ProfileError(403, CONFIRM_WITH_CODE, "AUTH_REAUTH_REQUIRED") : new ProfileError(403, "The password is not right.", "PROFILE_PASSWORD_WRONG", { field: "password" });
  const email = String(newEmail ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) throw new ProfileError(422, "Enter a valid email address.", "PROFILE_INVALID", { field: "newEmail" });
  if (email === user.email.toLowerCase()) throw new ProfileError(422, "That is already your email address.", "PROFILE_INVALID", { field: "newEmail" });
  if ((await client.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email])).rows[0]) {
    throw new ProfileError(409, "Another account already uses that email address.", "PROFILE_EMAIL_TAKEN", { field: "newEmail" });
  }
  await client.query(`UPDATE email_change_requests SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [session.userId]);
  const token = createOpaqueToken();
  await client.query(`INSERT INTO email_change_requests (user_id, new_email, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [session.userId, email, tokenHash(token), EMAIL_CHANGE_TTL_HOURS]);
  const base = (env.APP_URL || "http://localhost:3001").replace(/\/$/, "");
  await queueSecurityMail(client, { type: "confirm-email-change", email, url: `${base}/confirm-email?token=${encodeURIComponent(token)}`, expiresIn: `${EMAIL_CHANGE_TTL_HOURS} hours`, organizationId: session.organizationId }, env);
  await sendSecurityAlert(user, { subject: "A change of email was requested", heading: "Someone asked to change your email",
    message: `A request was made to change the email of your account to ${email}. It takes effect only when confirmed from that address.` }, env, client).catch(() => false);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "auth.email_change.requested", entityType: "user", entityId: session.userId });
  return { sentTo: email, expiresInHours: EMAIL_CHANGE_TTL_HOURS };
}

// The link from the new address: the email changes (and counts as verified). Both addresses are told.
export async function confirmEmailChange(client, token, env = process.env) {
  const claimed = (await client.query(
    `UPDATE email_change_requests SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id, new_email`, [tokenHash(String(token ?? ""))])).rows[0];
  if (!claimed) throw new ProfileError(400, "This link is invalid, already used, or has expired. Ask for a new one from your profile.", "PROFILE_EMAIL_TOKEN_INVALID");
  if ((await client.query(`SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2`, [claimed.new_email, claimed.user_id])).rows[0]) {
    throw new ProfileError(409, "Another account started using that email address meanwhile.", "PROFILE_EMAIL_TAKEN");
  }
  const before = await userRow(client, claimed.user_id);
  await client.query(`UPDATE users SET email = $2, email_verified_at = now(), updated_at = now() WHERE id = $1`, [claimed.user_id, claimed.new_email]);
  await audit(client, { organizationId: null, actorUserId: claimed.user_id, eventType: "auth.email.changed", entityType: "user", entityId: claimed.user_id,
    beforeData: { email: before.email }, afterData: { email: claimed.new_email } });
  await sendSecurityAlert(before, { subject: "Your Vercentlabs ERP email was changed", heading: "Your email was changed",
    message: `The email of your account is now ${claimed.new_email}. Sign in with it from now on.` }, env, client).catch(() => false);
  return { email: claimed.new_email };
}
