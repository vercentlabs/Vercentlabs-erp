BEGIN;

-- Shared-platform security review (SP007 follow-up): the TOTP verifier
-- (services/api/src/core/mfa.js's verifyTotpCode) accepted any code
-- matching the previous/current/next 30-second step, but nothing recorded
-- which step had already been consumed -- a valid code could be replayed
-- any number of times within its ~90-second validity window. Standard TOTP
-- implementations (RFC 6238 in practice, not just in the letter of the
-- spec) track the last successfully verified step per subject and reject
-- a non-increasing one, precisely to close this window. mfa_last_used_step
-- is that record: NULL until the first successful verification, then
-- advanced atomically on every success, and a verification attempt whose
-- step is not strictly greater than the stored value is rejected as a
-- replay before the code is even considered "correct."
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_last_used_step bigint;

COMMIT;
