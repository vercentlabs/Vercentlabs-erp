// SP007 -- MFA enrollment, verification, recovery and organization-enforced
// step-up authentication. users.mfa_required/mfa_enrolled_at have existed
// since migration 002 as pure state flags with no behavior anywhere behind
// them (confirmed by repository search before writing this module) -- this
// is that missing behavior: real TOTP (RFC 6238) secret generation,
// encrypted-at-rest storage, code verification, single-use recovery codes,
// and the per-session step-up gate resolveSessionContext (session.js)
// exposes to apps/web/src/core/session.ts.
//
// Deliberately hand-rolled on node:crypto rather than a TOTP dependency --
// matches this module's own established convention (session.js's scrypt
// password hashing, platform/integrations/secrets.js's AES-256-GCM envelope) of no external
// crypto/auth library anywhere in services/api.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { encryptIntegrationCredentials, decryptIntegrationCredentials } from "./platform/integrations/secrets.js";
import { requireSessionPermission } from "./access-control-runtime.js";

export class MfaError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "MfaError";
    this.status = status;
    this.code = code;
  }
}

const PENDING_ENROLLMENT_TTL_MINUTES = 10;
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW_STEPS = 1; // accept the previous/current/next 30s step, absorbs clock drift
const RECOVERY_CODE_COUNT = 10;

// ---------------------------------------------------------------------
// Base32 (RFC 4648, no padding) -- the standard encoding authenticator
// apps (Google Authenticator, 1Password, Authy, ...) expect in an
// otpauth:// secret parameter and for manual entry.
// ---------------------------------------------------------------------
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const cleaned = String(text || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------
// TOTP (RFC 6238) over HOTP (RFC 4226)
// ---------------------------------------------------------------------
function hotp(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function totpAt(secretBuffer, unixSeconds) {
  return hotp(secretBuffer, Math.floor(unixSeconds / TOTP_STEP_SECONDS));
}

function constantTimeStringEqual(a, b) {
  const bufferA = Buffer.from(String(a || ""));
  const bufferB = Buffer.from(String(b || ""));
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

// Matches a 6-digit code against every step in [-window, +window] around
// now — never just the exact current step, since a real authenticator app
// and this server's clock are never perfectly synchronized, and a user
// typing a code that just rolled over is a routine, not exceptional, case.
// Returns the absolute step counter that matched, or null. A match here is
// NOT sufficient on its own to accept the code — see claimTotpStep below;
// a code is only genuinely proven "not already used" once its step has
// been atomically claimed.
function matchTotpStep(secretBuffer, code) {
  const normalized = String(code || "").trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const now = Math.floor(Date.now() / 1000);
  for (let stepOffset = -TOTP_WINDOW_STEPS; stepOffset <= TOTP_WINDOW_STEPS; stepOffset += 1) {
    const step = Math.floor((now + stepOffset * TOTP_STEP_SECONDS) / TOTP_STEP_SECONDS);
    const candidate = hotp(secretBuffer, step);
    if (constantTimeStringEqual(candidate, normalized)) return step;
  }
  return null;
}

// REPLAY PROTECTION: a valid TOTP code otherwise remains acceptable for
// its entire ~90-second window (previous/current/next step) and, absent
// this check, could be submitted more than once within that window --
// e.g. replayed by anyone who observed it in transit or in a log, or
// simply resubmitted by an automated retry. Atomically records the
// highest step ever successfully used per user and refuses to accept a
// step that is not strictly greater than that -- a single UPDATE ... WHERE
// closes the race between two concurrent requests racing to claim the
// same step. Returns true iff this step had not already been consumed.
async function claimTotpStep(client, userId, step) {
  const result = await client.query(
    `UPDATE users SET mfa_last_used_step = $2
      WHERE id = $1 AND (mfa_last_used_step IS NULL OR mfa_last_used_step < $2)
      RETURNING id`,
    [userId, step],
  );
  return Boolean(result.rows[0]);
}

// Combines match + claim: the one call site every TOTP check should use.
async function verifyAndClaimTotpCode(client, userId, secretBuffer, code) {
  const step = matchTotpStep(secretBuffer, code);
  if (step === null) return false;
  return claimTotpStep(client, userId, step);
}

function totpUri(secretBase32, email, issuer = "Vercentlabs ERP") {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — never ambiguous when read aloud or handwritten

function generateRecoveryCode() {
  const bytes = randomBytes(10);
  let code = "";
  for (const byte of bytes) code += RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length];
  return `${code.slice(0, 5)}-${code.slice(5, 10)}`;
}

function recoveryCodeHash(code) {
  return createHash("sha256").update(code.toUpperCase().trim()).digest("hex");
}

async function issueRecoveryCodes(client, userId) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await client.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);
  for (const code of codes) {
    await client.query(
      `INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES ($1, $2, $3)`,
      [randomUUID(), userId, recoveryCodeHash(code)],
    );
  }
  return codes;
}

async function consumeRecoveryCode(client, userId, code) {
  const normalized = String(code || "").toUpperCase().trim();
  if (!normalized) return false;
  const claimed = await client.query(
    `UPDATE mfa_recovery_codes
        SET used_at = now()
      WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
      RETURNING id`,
    [userId, recoveryCodeHash(normalized)],
  );
  return Boolean(claimed.rows[0]);
}

// ---------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------

// Starts (or restarts) enrollment: generates a fresh secret, stores it
// encrypted as PENDING (never active) with a short expiry. Calling this
// again before confirming simply replaces the pending attempt — an
// abandoned QR scan can never accumulate stale, still-guessable pending
// secrets.
export async function beginMfaEnrollment(client, userId, env = process.env) {
  const user = (await client.query(`SELECT id, email, mfa_enrolled_at FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user) throw new MfaError(404, "User not found.", "MFA_USER_NOT_FOUND");
  if (user.mfa_enrolled_at) {
    throw new MfaError(409, "MFA is already enabled. Disable it before enrolling a new authenticator.", "MFA_ALREADY_ENROLLED");
  }

  const secretBuffer = randomBytes(20); // 160-bit, RFC 4226's recommended HOTP secret length
  const secretBase32 = base32Encode(secretBuffer);
  const encrypted = encryptIntegrationCredentials({ secretBase32 }, env);

  await client.query(
    `UPDATE users
        SET mfa_pending_secret_encrypted = $2,
            mfa_pending_secret_expires_at = now() + interval '${PENDING_ENROLLMENT_TTL_MINUTES} minutes'
      WHERE id = $1`,
    [userId, JSON.stringify(encrypted)],
  );

  return { secretBase32, otpauthUri: totpUri(secretBase32, user.email) };
}

// Confirms enrollment by requiring one real, currently-valid code from the
// pending secret — proves the user actually has a working authenticator
// configured with it before it ever becomes the active factor. Returns
// recovery codes in PLAINTEXT exactly once; only their hashes are ever
// stored (mirrors password_hash/token_hash's own never-store-plaintext
// convention).
export async function confirmMfaEnrollment(client, userId, code, env = process.env) {
  const user = (
    await client.query(
      `SELECT id, mfa_pending_secret_encrypted, mfa_pending_secret_expires_at, mfa_enrolled_at
         FROM users WHERE id = $1`,
      [userId],
    )
  ).rows[0];
  if (!user) throw new MfaError(404, "User not found.", "MFA_USER_NOT_FOUND");
  if (user.mfa_enrolled_at) throw new MfaError(409, "MFA is already enabled.", "MFA_ALREADY_ENROLLED");
  if (!user.mfa_pending_secret_encrypted) {
    throw new MfaError(400, "No MFA enrollment is in progress. Start enrollment again.", "MFA_ENROLLMENT_NOT_STARTED");
  }
  if (!user.mfa_pending_secret_expires_at || new Date(user.mfa_pending_secret_expires_at).getTime() < Date.now()) {
    await client.query(`UPDATE users SET mfa_pending_secret_encrypted = NULL, mfa_pending_secret_expires_at = NULL WHERE id = $1`, [userId]);
    throw new MfaError(400, "This enrollment attempt expired. Start enrollment again.", "MFA_ENROLLMENT_EXPIRED");
  }

  const { secretBase32 } = decryptIntegrationCredentials(user.mfa_pending_secret_encrypted, env);
  const secretBuffer = base32Decode(secretBase32);
  if (!(await verifyAndClaimTotpCode(client, userId, secretBuffer, code))) {
    throw new MfaError(400, "That code is incorrect or expired. Check your authenticator app and try again.", "MFA_CODE_INVALID");
  }

  const activeEncrypted = encryptIntegrationCredentials({ secretBase32 }, env);
  await client.query(
    `UPDATE users
        SET mfa_secret_encrypted = $2,
            mfa_enrolled_at = now(),
            mfa_pending_secret_encrypted = NULL,
            mfa_pending_secret_expires_at = NULL
      WHERE id = $1`,
    [userId, JSON.stringify(activeEncrypted)],
  );

  return { recoveryCodes: await issueRecoveryCodes(client, userId) };
}

// ---------------------------------------------------------------------
// Login-time step-up verification
// ---------------------------------------------------------------------

// Verifies a code (TOTP or, as a fallback, a recovery code) against the
// user's ACTIVE secret and, on success, marks the current session as
// MFA-verified — the same "unlocks an already-created session" shape
// requireVerifiedUser's email check uses, not a separate pre-session
// token. A recovery code is single-use and consumed here, never replayed.
export async function verifyMfaForSession(client, { sessionId, userId, code }, env = process.env) {
  const user = (await client.query(`SELECT id, mfa_secret_encrypted, mfa_enrolled_at FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user?.mfa_enrolled_at || !user.mfa_secret_encrypted) {
    throw new MfaError(409, "MFA is not enabled for this account.", "MFA_NOT_ENROLLED");
  }

  const normalizedCode = String(code || "").trim();
  let verified = false;
  if (/^\d{6}$/.test(normalizedCode.replace(/\s+/g, ""))) {
    const { secretBase32 } = decryptIntegrationCredentials(user.mfa_secret_encrypted, env);
    verified = await verifyAndClaimTotpCode(client, userId, base32Decode(secretBase32), normalizedCode);
  } else {
    verified = await consumeRecoveryCode(client, userId, normalizedCode);
  }
  if (!verified) throw new MfaError(400, "That code is incorrect or has already been used.", "MFA_CODE_INVALID");

  const updated = await client.query(
    `UPDATE sessions SET mfa_verified_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
    [sessionId, userId],
  );
  if (!updated.rows[0]) throw new MfaError(401, "Your session has expired. Sign in again.", "MFA_SESSION_INVALID");
  return { verified: true };
}

// ---------------------------------------------------------------------
// Disable / recovery-code regeneration -- both are sensitive, high-impact
// changes (SP007-SEC), so both require a fresh code, exactly like
// verifyMfaForSession -- proof the caller still controls the factor being
// changed, not just an already-authenticated session. Both also revoke
// every session for the user afterward, the same "a credential-relevant
// change must not let an existing session silently keep working under the
// old security posture" rule resetPasswordWithToken already applies to
// password changes (auth-lifecycle.js).
// ---------------------------------------------------------------------

async function requireFreshMfaProof(client, userId, code, env) {
  const user = (await client.query(`SELECT mfa_secret_encrypted, mfa_enrolled_at FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user?.mfa_enrolled_at || !user.mfa_secret_encrypted) throw new MfaError(409, "MFA is not enabled for this account.", "MFA_NOT_ENROLLED");
  const normalizedCode = String(code || "").trim();
  let verified = false;
  if (/^\d{6}$/.test(normalizedCode.replace(/\s+/g, ""))) {
    const { secretBase32 } = decryptIntegrationCredentials(user.mfa_secret_encrypted, env);
    verified = await verifyAndClaimTotpCode(client, userId, base32Decode(secretBase32), normalizedCode);
  } else {
    verified = await consumeRecoveryCode(client, userId, normalizedCode);
  }
  if (!verified) throw new MfaError(400, "That code is incorrect or has already been used.", "MFA_CODE_INVALID");
}

export async function disableMfa(client, userId, code, env = process.env) {
  await requireFreshMfaProof(client, userId, code, env);
  await client.query(
    `UPDATE users SET mfa_secret_encrypted = NULL, mfa_enrolled_at = NULL, mfa_pending_secret_encrypted = NULL, mfa_pending_secret_expires_at = NULL WHERE id = $1`,
    [userId],
  );
  await client.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);
  await client.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'mfa_disabled' WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  return { disabled: true };
}

export async function regenerateRecoveryCodes(client, userId, code, env = process.env) {
  await requireFreshMfaProof(client, userId, code, env);
  return { recoveryCodes: await issueRecoveryCodes(client, userId) };
}

// ---------------------------------------------------------------------
// Organization-enforced MFA (SP007) -- platform.security.manage, granted
// only to organization_owner/system_administrator by migration 047 (never
// company_administrator, matching that role's existing exclusion from
// every other organisation/system-level platform.*.manage permission).
// ---------------------------------------------------------------------
export async function setOrganizationMfaEnforcement(client, session, enforced) {
  requireSessionPermission(session, "platform.security.manage");
  if (!session.organizationId) throw new MfaError(400, "An active organization is required.", "MFA_NO_ORGANIZATION");
  const updated = await client.query(
    `UPDATE organizations SET mfa_enforced = $2, updated_at = now() WHERE id = $1 RETURNING mfa_enforced`,
    [session.organizationId, Boolean(enforced)],
  );
  if (!updated.rows[0]) throw new MfaError(404, "Organization not found.", "MFA_ORGANIZATION_NOT_FOUND");
  return { mfaEnforced: updated.rows[0].mfa_enforced };
}

// Exported for tests and for anything that needs the raw TOTP primitives
// without the DB-facing enrollment ceremony around them.
export const __internal = { base32Encode, base32Decode, hotp, totpAt, matchTotpStep, claimTotpStep, totpUri, generateRecoveryCode, recoveryCodeHash };
