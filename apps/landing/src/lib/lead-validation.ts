export type LeadKind = "contact" | "signup";

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
};

type ValidationResult =
  | {
      success: true;
      data: LeadPayload;
    }
  | {
      success: false;
      errors: Record<string, string>;
    };

function text(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maximumLength);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateLeadPayload(
  input: unknown,
  kind: LeadKind,
): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      success: false,
      errors: {
        form: "Invalid request.",
      },
    };
  }

  const value = input as Record<string, unknown>;

  const data: LeadPayload = {
    kind,
    name: text(value.name, 100),
    email: text(value.email, 160).toLowerCase(),
    company: text(value.company, 160),
    phone: text(value.phone, 40),
    interest: text(value.interest, 100),
    teamSize: text(value.teamSize, 60),
    message: text(value.message, 2000),
    consent: value.consent === true,
    website: text(value.website, 200),
  };

  const errors: Record<string, string> = {};

  if (data.name.length < 2) {
    errors.name = "Enter your full name.";
  }

  if (!validEmail(data.email)) {
    errors.email = "Enter a valid email address.";
  }

  if (data.company.length < 2) {
    errors.company = "Enter your organisation name.";
  }

  if (!data.consent) {
    errors.consent = "Confirm that VercentLabs may respond to this request.";
  }

  if (kind === "contact" && data.message.length < 10) {
    errors.message = "Describe the business problem or requirement.";
  }

  if (kind === "signup" && data.interest.length < 2) {
    errors.interest = "Select the main area you want to explore.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      success: false,
      errors,
    };
  }

  return {
    success: true,
    data,
  };
}
