import { z } from "zod";

// Editable fields for the Lead create/edit form. Matches the writable
// subset of resources.leads.fields (resource-registry.js) — status,
// qualificationStatus, score, ownerUserId, and recordStatus are governed
// through dedicated actions (assign/stage/qualify/scoring), not this form.
export const leadFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(120),
  lastName: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  mobile: z.string().trim().max(40).optional().or(z.literal("")),
  companyName: z.string().trim().max(200).optional().or(z.literal("")),
  jobTitle: z.string().trim().max(150).optional().or(z.literal("")),
  website: z.string().trim().max(300).optional().or(z.literal("")),
  industry: z.string().trim().max(150).optional().or(z.literal("")),
  sourceId: z.string().uuid().optional().or(z.literal("")),
  campaignId: z.string().uuid().optional().or(z.literal("")),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  rating: z.enum(["cold", "warm", "hot"]).optional().or(z.literal("")),
  estimatedValue: z.number().nonnegative().nullable().optional(),
  currencyCode: z.string().trim().length(3).optional().or(z.literal("")),
  city: z.string().trim().max(150).optional().or(z.literal("")),
  state: z.string().trim().max(150).optional().or(z.literal("")),
  countryCode: z.string().trim().max(2).optional().or(z.literal("")),
  productInterest: z.string().trim().max(300).optional().or(z.literal("")),
  consentEmail: z.boolean(),
  consentSms: z.boolean(),
  consentWhatsapp: z.boolean(),
  doNotContact: z.boolean(),
});

export type LeadFormValues = z.infer<typeof leadFormSchema>;

export const leadFormDefaults: LeadFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  mobile: "",
  companyName: "",
  jobTitle: "",
  website: "",
  industry: "",
  sourceId: "",
  campaignId: "",
  priority: "medium",
  rating: "",
  estimatedValue: null,
  currencyCode: "",
  city: "",
  state: "",
  countryCode: "",
  productInterest: "",
  consentEmail: false,
  consentSms: false,
  consentWhatsapp: false,
  doNotContact: false,
};

// Strips empty-string optionals to null/undefined before sending to the
// API — the form keeps "" for controlled-input ergonomics, the backend
// resource-registry expects null for "no value".
export function leadFormValuesToInput(values: LeadFormValues): Record<string, unknown> {
  const input: Record<string, unknown> = { ...values };
  for (const key of Object.keys(input)) {
    if (input[key] === "") input[key] = null;
  }
  return input;
}
