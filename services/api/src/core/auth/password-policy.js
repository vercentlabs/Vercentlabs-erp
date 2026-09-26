// Reconstructed gap: invitations/accept/route.ts and the reset-password
// flow both reference passwordPolicyIssues() from "@/core/password-policy",
// but that source file was never itself among the 42 recovered files.
// Rebuilt with a conservative minimum-strength policy rather than left
// unimplemented. See docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv, the
// "(gap - referenced but not recovered)" row under invitations/accept.
const MINIMUM_LENGTH = 12;
const MAXIMUM_LENGTH = 200;

export function passwordPolicyIssues(password, { email } = {}) {
  const issues = [];
  const value = String(password || "");
  if (value.length < MINIMUM_LENGTH) {
    issues.push(`Password must be at least ${MINIMUM_LENGTH} characters.`);
  }
  if (value.length > MAXIMUM_LENGTH) {
    issues.push(`Password must be at most ${MAXIMUM_LENGTH} characters.`);
  }
  if (/^\d+$/.test(value)) {
    issues.push("Password must not be entirely numeric.");
  }
  if (!/[a-z]/i.test(value) || !/[0-9]/.test(value)) {
    issues.push("Password must include at least one letter and one number.");
  }
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (normalizedEmail && value.toLowerCase().includes(normalizedEmail)) {
    issues.push("Password must not contain your email address.");
  }
  return issues;
}
