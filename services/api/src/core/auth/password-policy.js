// Conservative minimum-strength password policy, shared by invitation
// acceptance and the reset-password flow (passwordPolicyIssues()).
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
