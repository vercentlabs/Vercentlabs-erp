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
]);

function normalize(field: CrmField, value: unknown) {
  if (field.type === "checkbox") return Boolean(value);
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

export const crmSchemas = Object.fromEntries(
  Object.entries(crmDefinitions).map(([key, definition]) => [
    key,
    z
      .record(z.string(), z.unknown())
      .superRefine((input, context) => {
        for (const field of definition.fields) {
          const value = input[field.name];
          if (
            field.required &&
            (value === undefined ||
              value === null ||
              String(value).trim() === "")
          ) {
            context.addIssue({
              code: "custom",
              path: [field.name],
              message: `${field.label} is required.`,
            });
          }
        }
      })
      .transform((input) =>
        Object.fromEntries(
          definition.fields
            .filter((field) => input[field.name] !== undefined)
            .map((field) => [field.name, normalize(field, input[field.name])]),
        ),
      ),
  ]),
) as unknown as Record<
  keyof typeof crmDefinitions,
  z.ZodType<Record<string, unknown>>
>;

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
export const publicCaptureSchema = z.record(z.string(), z.unknown());
