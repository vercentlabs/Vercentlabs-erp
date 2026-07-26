export type LeadKind = "contact" | "demo";

export const contactInterests = [
  "ERP discovery",
  "Product pilot",
  "Implementation partnership",
  "Technology integration",
  "Careers and collaboration",
  "Other",
] as const;

export const demoInterests = [
  "Released CRM workflow",
  "Permissions and operating context",
  "Approvals and audit history",
  "Business master data",
  "Mobile CRM",
  "ERP roadmap discussion",
] as const;

export const teamSizes = [
  "1–10",
  "11–50",
  "51–200",
  "201–500",
  "500+",
] as const;

export type LeadPayload = {
  kind: LeadKind;
  name: string;
  email: string;
  company: string;
  phone: string;
  interest: string;
  teamSize: string;
  message: string;
  consent: boolean;
  website: string;
  startedAt: number;
};

type ValidationResult =
  | { success: true; data: LeadPayload }
  | { success: false; errors: Record<string, string> };

function cleanText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maximumLength);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isAllowed(value: string, allowed: readonly string[]) {
  return !value || allowed.includes(value);
}

export function validateLeadPayload(
  input: unknown,
  kind: LeadKind,
): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { success: false, errors: { form: "Invalid request." } };
  }

  const value = input as Record<string, unknown>;
  const data: LeadPayload = {
    kind,
    name: cleanText(value.name, 100),
    email: cleanText(value.email, 160).toLowerCase(),
    company: cleanText(value.company, 160),
    phone: cleanText(value.phone, 40),
    interest: cleanText(value.interest, 100),
    teamSize: cleanText(value.teamSize, 60),
    message: cleanText(value.message, 2000),
    consent: value.consent === true,
    website: cleanText(value.website, 200),
    startedAt: Number(value.startedAt || 0),
  };

  const errors: Record<string, string> = {};

  if (data.name.length < 2) errors.name = "Enter your full name.";
  if (!validEmail(data.email)) {
    errors.email = "Enter a valid work email address.";
  }
  if (data.company.length < 2) {
    errors.company = "Enter your organisation name.";
  }
  if (data.phone && !/^[0-9+()\-\s]{7,40}$/.test(data.phone)) {
    errors.phone = "Enter a valid phone number.";
  }
  if (!data.consent) {
    errors.consent = "Confirm that Vercentlabs may respond to this request.";
  }

  const allowedInterests = kind === "demo" ? demoInterests : contactInterests;
  if (!isAllowed(data.interest, allowedInterests)) {
    errors.interest = "Select a valid discussion area.";
  }
  if (kind === "demo" && !data.interest) {
    errors.interest = "Select the area you want to review.";
  }
  if (!isAllowed(data.teamSize, teamSizes)) {
    errors.teamSize = "Select a valid team size.";
  }
  if (kind === "contact" && data.message.length < 10) {
    errors.message = "Describe the business problem or requirement.";
  }
  if (
    data.startedAt <= 0 ||
    Date.now() - data.startedAt > 24 * 60 * 60 * 1000
  ) {
    errors.form = "The form session expired. Refresh the page and try again.";
  }

  return Object.keys(errors).length
    ? { success: false, errors }
    : { success: true, data };
}
