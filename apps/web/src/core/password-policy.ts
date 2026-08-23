import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 8;

const commonPasswords = new Set([
  "password",
  "password123",
  "password1234",
  "123456789012345",
  "qwertyuiopasdfg",
  "adminadminadmin",
  "letmeinletmein",
  "welcome1234567",
  "vercentlabs123",
  "companyname1234",
]);

export function passwordPolicyIssues(password: string) {
  const issues: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH)
    issues.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password.length > 128) issues.push("Use no more than 128 characters.");
  if (commonPasswords.has(password.toLowerCase()))
    issues.push("Choose a password that is not commonly used.");
  if (/^(.)\1+$/.test(password))
    issues.push("Do not repeat a single character.");
  if (/^\s|\s$/.test(password))
    issues.push("Do not begin or end the password with a space.");
  return issues;
}

export const passwordSchema = z.string().superRefine((value, context) => {
  for (const issue of passwordPolicyIssues(value)) {
    context.addIssue({ code: "custom", message: issue });
  }
});
