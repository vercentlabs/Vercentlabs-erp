/**
 * Shared client+server validation for the demo-request form. Deliberately not
 * a dependency on zod (apps/landing has no runtime-validation dependency yet,
 * and this shape is simple enough not to need one — see phase-3 decision-log.md).
 */

export interface DemoFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  jobTitle: string;
  industry: string;
  companySize: string;
  primaryInterest: string;
  mainChallenge: string;
  preferredContactTime: string;
  consentEmail: boolean;
  /** Honeypot fields — a real submission always leaves these empty. */
  websiteUrl: string;
  companyWebsiteHidden: string;
}

export type DemoFormErrors = Partial<Record<keyof DemoFormValues, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\d][\d\s().-]{6,19}$/;

export const INDUSTRY_OPTIONS = ["Manufacturing", "Distribution & retail", "Professional services", "Other"] as const;
export const COMPANY_SIZE_OPTIONS = ["1-10", "11-50", "51-200", "201-500", "500+"] as const;
export const PRIMARY_INTEREST_OPTIONS = [
  "CRM & Sales",
  "Procurement & Stock",
  "Manufacturing",
  "Accounting & Finance",
  "Projects",
  "The full platform",
] as const;
export const CONTACT_TIME_OPTIONS = ["Morning", "Afternoon", "Evening", "No preference"] as const;

/**
 * Coerces an arbitrary value to a trimmed string without throwing — this
 * function runs at a public API boundary (app/api/book-demo/route.ts posts
 * whatever JSON body a caller sends, not just what the real form UI
 * produces), so it must never assume a field is present or string-typed.
 */
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateDemoForm(values: Partial<DemoFormValues>): DemoFormErrors {
  const errors: DemoFormErrors = {};

  if (!str(values.firstName)) errors.firstName = "Enter your first name.";
  const email = str(values.email);
  if (!email) {
    errors.email = "Enter your work email.";
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  const phone = str(values.phone);
  if (!phone) {
    errors.phone = "Enter a phone number.";
  } else if (!PHONE_PATTERN.test(phone)) {
    errors.phone = "Enter a valid phone number.";
  }
  if (!str(values.companyName)) errors.companyName = "Enter your company name.";
  // Role, industry, company size, and primary interest are deliberately optional —
  // docs/landing-redesign/phase-1/conversion-architecture.md's single-step form
  // spec requires only name/email/company/phone, on the evidence that mid-market
  // buyers abandon forms with more required fields; qualification happens on the
  // sales call, not at the form. See docs/landing-redesign/phase-3/decision-log.md.
  if (!values.consentEmail) errors.consentEmail = "Please confirm we can contact you about this request.";

  // Honeypot: a real user never fills these. If they're non-empty, reject outright.
  if (str(values.websiteUrl) || str(values.companyWebsiteHidden)) {
    errors.websiteUrl = "Submission rejected.";
  }

  return errors;
}

export function isDemoFormValid(values: Partial<DemoFormValues>): boolean {
  return Object.keys(validateDemoForm(values)).length === 0;
}
