// Signing in with an email code (MVP 44), and confirming it's you with one when you have no password. Same code rules as signup.
// An email with no workspace is never reported as such ("If this email has a workspace, we've sent a code"); its email invites them to
// set one up instead. People with a password keep using it: the password check stays exactly as it was.
import { checkEmailCode, issueEmailCode } from "./email-code.js";
import { verifyPassword } from "./session.js";

const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] || null;
export const REAUTH_MINUTES = 10;

export async function requestSignInCode(client, email, env = process.env) {
  const address = String(email ?? "").trim().toLowerCase();
  const user = (await client.query(`SELECT id, full_name, status FROM public.users WHERE lower(email) = $1`, [address])).rows[0];
  if (user && user.status === "active") await issueEmailCode(client, { email: address, purpose: "sign_in", userId: user.id, firstName: firstName(user.full_name) }, env);
  else await issueEmailCode(client, { email: address, purpose: "sign_in", mail: "no_account" }, env);
  return { message: "If this email has a workspace, we've sent a code." };
}

// Returns { ok: true, userId } or { ok: false, reason } (the counted try is committed by the caller before it reports the outcome).
export async function verifySignInCode(client, email, code, env = process.env) {
  const address = String(email ?? "").trim().toLowerCase();
  const result = await checkEmailCode(client, { email: address, purpose: "sign_in", code });
  if (!result.ok) {
    if (result.reason === "expired") await requestSignInCode(client, address, env).catch(() => undefined);
    return { ok: false, reason: result.reason };
  }
  const user = (await client.query(`SELECT id, status FROM public.users WHERE lower(email) = $1`, [address])).rows[0];
  if (!user || user.status !== "active" || user.id !== result.row.user_id) return { ok: false, reason: "wrong" };
  await client.query(`UPDATE public.users SET email_verified_at = COALESCE(email_verified_at, now()), last_login_at = now() WHERE id = $1`, [user.id]);
  return { ok: true, userId: user.id };
}

// "Confirm it's you" for someone without a password: a code to their own email; entering it marks this session confirmed for 10 minutes.
export async function requestReauthCode(client, session, env = process.env) {
  return issueEmailCode(client, { email: session.email, purpose: "reauth", userId: session.userId, firstName: firstName(session.fullName) }, env);
}
export async function verifyReauthCode(client, session, code) {
  const result = await checkEmailCode(client, { email: session.email, purpose: "reauth", code });
  if (result.ok) await client.query(`UPDATE public.sessions SET reauthenticated_at = now() WHERE id = $1 AND user_id = $2`, [session.sessionId, session.userId]);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

// The check before a sensitive change: the password, for someone who has one; otherwise a code confirmed on this session within the last
// 10 minutes. Returns { ok, needsCode } — needsCode when the person has no password.
export async function identityConfirmed(client, { userId, sessionId, password }) {
  const user = (await client.query(`SELECT password_hash FROM public.users WHERE id = $1`, [userId])).rows[0];
  if (user?.password_hash) return { ok: await verifyPassword(String(password ?? ""), user.password_hash), needsCode: false };
  const confirmed = sessionId ? (await client.query(`SELECT 1 FROM public.sessions WHERE id = $1 AND user_id = $2 AND reauthenticated_at > now() - ($3 || ' minutes')::interval`,
    [sessionId, userId, String(REAUTH_MINUTES)])).rows[0] : null;
  return { ok: Boolean(confirmed), needsCode: true };
}
export const CONFIRM_WITH_CODE = "Confirm it's you with the code we email you, then try again.";
