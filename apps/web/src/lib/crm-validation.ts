import { z } from "zod";

import { crmDefinitions, type CrmField } from "@/lib/crm";

const jsonFields = new Set([
  "customData",
  "comparisonValue",
  "criteria",
  "roundRobinUserIds",
  "allowedOrigins",
  "requiredFields",
  "configuration",
  "eventTypes",
  "filters",
  "sort",
  "columns",
  "assignmentRules",
  "objectives",
  "risks",
  "whiteSpace",
  "successPlan",
  "evidence",
  "issues",
  "responseOptions",
  "response",
]);

function normalize(field: CrmField, value: unknown) {
  if (field.type === "checkbox") {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    }
    return Boolean(value);
  }
  if (value === undefined || value === null || value === "") return null;
  if (field.type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number))
      throw new Error(`${field.label} must be a number.`);
    return number;
  }
  if (jsonFields.has(field.name)) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`${field.label} must contain valid JSON.`);
    }
  }
  return String(value).trim();
}

function buildCrmSchemas(requireRequiredFields: boolean) {
  return Object.fromEntries(
    Object.entries(crmDefinitions).map(([key, definition]) => [
      key,
      z
        .record(z.string(), z.unknown())
        .superRefine((input, context) => {
          for (const field of definition.fields) {
            const value = input[field.name];
            const empty =
              value === undefined ||
              value === null ||
              String(value).trim() === "";
            if (requireRequiredFields && field.required && empty) {
              context.addIssue({
                code: "custom",
                path: [field.name],
                message: `${field.label} is required.`,
              });
            }
            if (!empty && field.options) {
              const allowed = new Set(
                field.options.map((option) => option.value),
              );
              if (!allowed.has(String(value))) {
                context.addIssue({
                  code: "custom",
                  path: [field.name],
                  message: `${field.label} contains an unsupported value.`,
                });
              }
            }
            if (!empty && field.type === "email") {
              const email = String(value).trim();
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                context.addIssue({
                  code: "custom",
                  path: [field.name],
                  message: `${field.label} must be a valid email address.`,
                });
              }
            }
            if (!empty && field.type === "checkbox") {
              const validBoolean =
                typeof value === "boolean" ||
                (typeof value === "string" &&
                  [
                    "true",
                    "false",
                    "1",
                    "0",
                    "yes",
                    "no",
                    "on",
                    "off",
                  ].includes(value.trim().toLowerCase()));
              if (!validBoolean) {
                context.addIssue({
                  code: "custom",
                  path: [field.name],
                  message: `${field.label} must be true or false.`,
                });
              }
            }
            if (!empty && field.type === "number") {
              const number = Number(value);
              if (!Number.isFinite(number)) {
                context.addIssue({
                  code: "custom",
                  path: [field.name],
                  message: `${field.label} must be a number.`,
                });
              }
            }
            if (
              !empty &&
              (field.type === "date" || field.type === "datetime-local")
            ) {
              const text = String(value);
              const expectedFormat =
                field.type === "date"
                  ? /^\d{4}-\d{2}-\d{2}$/
                  : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
              if (
                !expectedFormat.test(text) ||
                !Number.isFinite(Date.parse(text))
              ) {
                context.addIssue({
                  code: "custom",
                  path: [field.name],
                  message: `${field.label} must be a valid ${field.type === "date" ? "date" : "date and time"}.`,
                });
              }
            }
            if (
              !empty &&
              jsonFields.has(field.name) &&
              typeof value === "string"
            ) {
              try {
                JSON.parse(value);
              } catch {
                context.addIssue({
                  code: "custom",
                  path: [field.name],
                  message: `${field.label} must contain valid JSON.`,
                });
              }
            }
            if (
              !empty &&
              (field.name.endsWith("Id") || field.name === "subjectId") &&
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                String(value),
              )
            ) {
              context.addIssue({
                code: "custom",
                path: [field.name],
                message: `${field.label} must be a valid UUID.`,
              });
            }
            if (!empty && typeof value === "string") {
              const maximum = field.type === "textarea" ? 50_000 : 4_000;
              if (value.length > maximum) {
                context.addIssue({
                  code: "custom",
                  path: [field.name],
                  message: `${field.label} is too long.`,
                });
              }
            }
          }

          const requireOneOf = (fields: string[], message: string) => {
            if (
              !fields.some((field) => {
                const value = input[field];
                return (
                  value !== undefined &&
                  value !== null &&
                  String(value).trim() !== ""
                );
              })
            ) {
              context.addIssue({ code: "custom", path: fields, message });
            }
          };

          if (key === "quota-plans")
            requireOneOf(
              ["teamId", "territoryId", "userId"],
              "Select at least one sales team, territory or salesperson.",
            );
          if (key === "consent-events")
            requireOneOf(
              ["leadId", "contactId", "partyId"],
              "Link consent evidence to at least one lead, contact or account.",
            );
          if (key === "playbook-responses") {
            const targets = ["opportunityId", "leadId"].filter((field) => {
              const value = input[field];
              return (
                value !== undefined &&
                value !== null &&
                String(value).trim() !== ""
              );
            });
            if (targets.length !== 1)
              context.addIssue({
                code: "custom",
                path: ["opportunityId", "leadId"],
                message:
                  "Link a playbook response to exactly one opportunity or lead.",
              });
          }
          for (const [startField, endField] of [
            ["periodStart", "periodEnd"],
            ["effectiveFrom", "effectiveTo"],
          ] as const) {
            const start = input[startField];
            const end = input[endField];
            if (start && end && String(start) > String(end))
              context.addIssue({
                code: "custom",
                path: [endField],
                message: `${endField} must not be earlier than ${startField}.`,
              });
          }
          for (const scoreField of [
            "confidencePercent",
            "healthScore",
            "engagementScore",
            "completenessScore",
            "validityScore",
            "freshnessScore",
            "duplicateRiskScore",
            "overallScore",
            "allocationPercent",
          ]) {
            const value = input[scoreField];
            if (value !== undefined && value !== null && value !== "") {
              const number = Number(value);
              if (!Number.isFinite(number) || number < 0 || number > 100)
                context.addIssue({
                  code: "custom",
                  path: [scoreField],
                  message: `${scoreField} must be between 0 and 100.`,
                });
            }
          }
        })
        .transform((input) =>
          Object.fromEntries(
            definition.fields
              .filter((field) => input[field.name] !== undefined)
              .map((field) => [
                field.name,
                normalize(field, input[field.name]),
              ]),
          ),
        ),
    ]),
  ) as unknown as Record<
    keyof typeof crmDefinitions,
    z.ZodType<Record<string, unknown>>
  >;
}

export const crmSchemas = buildCrmSchemas(true);
export const crmPatchSchemas = buildCrmSchemas(false);

export const convertLeadSchema = z.object({
  partyId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  createOpportunity: z.boolean().optional().default(true),
  opportunityName: z.string().trim().max(200).optional(),
  amount: z.coerce.number().min(0).optional(),
  currencyCode: z.string().trim().max(3).optional(),
  expectedCloseDate: z.string().nullable().optional(),
  nextStep: z.string().trim().max(2000).optional(),
});
export const mergeLeadSchema = z.object({ targetLeadId: z.string().uuid() });
export const moveStageSchema = z.object({
  stageId: z.string().uuid(),
  note: z.string().trim().max(1000).nullable().optional(),
});
export const completeActivitySchema = z.object({
  outcome: z.string().trim().max(4000).nullable().optional(),
});
export const duplicateSchema = z.object({
  email: z.string().email().nullable().optional(),
  mobile: z.string().max(30).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(),
  excludeId: z.string().uuid().nullable().optional(),
});
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
    customData: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
