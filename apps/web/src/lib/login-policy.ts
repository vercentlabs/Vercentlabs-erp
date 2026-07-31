import { query } from "@/lib/db";
import { clientIp, enforceRateLimit } from "@/lib/security";

export const GENERIC_LOGIN_FAILURE = "The email or password is incorrect.";

export type LoginCandidate = {
  id: string;
  status: string;
  email_verified_at: Date | null;
  locked_until: Date | null;
};

export type LoginFailureReason =
  | "unknown_account"
  | "invalid_password"
  | "account_disabled"
  | "email_unverified"
  | "account_locked";

export function isAccountLocked(
  user: Pick<LoginCandidate, "locked_until"> | null | undefined,
  now = Date.now(),
) {
  return Boolean(
    user?.locked_until && new Date(user.locked_until).getTime() > now,
  );
}

export function loginFailureReason(
  user: LoginCandidate | null | undefined,
  passwordValid: boolean,
): LoginFailureReason {
  if (!user) return "unknown_account";
  if (!passwordValid) return "invalid_password";
  if (user.status !== "active") return "account_disabled";
  if (!user.email_verified_at) return "email_unverified";
  if (isAccountLocked(user)) return "account_locked";
  return "unknown_account";
}

export function isLoginUsable(
  user: LoginCandidate | null | undefined,
  passwordValid: boolean,
) {
  return Boolean(
    user &&
    passwordValid &&
    user.status === "active" &&
    user.email_verified_at &&
    !isAccountLocked(user),
  );
}

export async function enforceLoginRateLimits(request: Request, email: string) {
  const ipAddress = clientIp(request);
  await enforceRateLimit(`login-ip:${ipAddress}`, 20, 900);
  await enforceRateLimit(`login-credential:${ipAddress}:${email}`, 10, 900);
}

export async function recordFailedPasswordAttempt(userId: string) {
  // Anonymous failures are useful telemetry, but they must never create a
  // global account lock that an attacker can trigger by knowing an email.
  await query(
    `UPDATE users
        SET failed_login_attempts = LEAST(failed_login_attempts + 1, 1000000),
            updated_at = now()
      WHERE id = $1`,
    [userId],
  );
}

export async function recordSuccessfulLogin(userId: string) {
  await query(
    `UPDATE users
        SET failed_login_attempts = 0,
            locked_until = NULL,
            last_login_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [userId],
  );
}
