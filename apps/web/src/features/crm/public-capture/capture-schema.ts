import { z } from "zod";

// Public web-to-lead submission (the landing site's demo form, or a
// customer's own site through a capture form key). Strict: unknown fields are
// refused; the two honeypot fields must stay empty.
export const publicCaptureSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().max(120).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    mobile: z.string().trim().max(30).nullable().optional(),
    companyName: z.string().trim().max(240).nullable().optional(),
    jobTitle: z.string().trim().max(160).nullable().optional(),
    website: z.string().trim().max(500).nullable().optional(),
    industry: z.string().trim().max(160).nullable().optional(),
    city: z.string().trim().max(160).nullable().optional(),
    state: z.string().trim().max(160).nullable().optional(),
    countryCode: z.string().trim().max(2).nullable().optional(),
    productInterest: z.string().trim().max(4_000).nullable().optional(),
    estimatedValue: z.coerce.number().min(0).max(1_000_000_000_000).optional(),
    currencyCode: z.string().trim().max(3).nullable().optional(),
    consentEmail: z.boolean().optional(),
    consentSms: z.boolean().optional(),
    consentWhatsapp: z.boolean().optional(),
    doNotContact: z.boolean().optional(),
    websiteUrl: z.string().max(0).optional(),
    companyWebsiteHidden: z.string().max(0).optional(),
    customData: z
      .record(z.string(), z.unknown())
      .refine((value) => Object.keys(value).length <= 40, { message: "customData accepts at most 40 fields." })
      .refine((value) => JSON.stringify(value).length <= 20_000, { message: "customData is too large." })
      .optional(),
  })
  .strict();
