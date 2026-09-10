import { getStructuredFieldConfig } from "@vercentlabs/shared-types";
import { z } from "zod";

import { crmDefinitions, type CrmField } from "@/modules/crm";

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
  if (
    Boolean(
      field.structuredKind || getStructuredFieldConfig(field.name, field.label),
    )
  ) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(
        `${field.label} contains an invalid advanced configuration.`,
      );
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
                  : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;
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
              Boolean(
                field.structuredKind ||
                getStructuredFieldConfig(field.name, field.label),
              ) &&
              typeof value === "string"
            ) {
              try {
                JSON.parse(value);
              } catch {
                context.addIssue({
                  code: "custom",
                  path: [field.name],
                  message: `${field.label} contains an invalid advanced configuration.`,
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

          if (key === "leads" && requireRequiredFields) {
            requireOneOf(
              ["email", "mobile", "phone"],
              "Provide at least one contact method: email, mobile number or alternate number.",
            );
          }

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

const crmDateTimeInputSchema = z
  .string()
  .trim()
  .min(1, "Due date and time is required.")
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
        value,
      ) && Number.isFinite(Date.parse(value)),
    "Due date and time must be valid.",
  );

export const scheduleLeadFollowUpSchema = z.object({
  activityType: z
    .enum(["task", "call", "meeting", "email", "whatsapp", "sms"])
    .default("call"),
  subject: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  assignedTo: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.string().uuid().nullable(),
  ),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueAt: crmDateTimeInputSchema,
});

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
export const updateOpportunityProbabilitySchema = z
  .object({
    probability: z.coerce.number().min(0).max(100).multipleOf(0.01),
    note: z.string().trim().max(1000).nullable().optional(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    expectedProbability: z.coerce.number().min(0).max(100).multipleOf(0.01),
  })
  .strict();
export const moveStageSchema = z.object({
  stageId: z.string().uuid(),
  note: z.string().trim().max(1000).nullable().optional(),
  outcomeReasonId: z.string().uuid().nullable().optional(),
  outcomeNotes: z.string().trim().max(4000).nullable().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  expectedStageId: z.string().uuid().nullable().optional(),
});
export const completeActivitySchema = z.object({
  outcome: z.string().trim().max(4000).nullable().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  expectedStatus: z.string().trim().min(1).max(40).optional(),
});
export const duplicateSchema = z.object({
  firstName: z.string().trim().max(120).nullable().optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  mobile: z.string().trim().max(30).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  companyName: z.string().trim().max(240).nullable().optional(),
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
    customData: z
      .record(z.string(), z.unknown())
      .refine((value) => Object.keys(value).length <= 40, {
        message: "customData accepts at most 40 fields.",
      })
      .refine((value) => JSON.stringify(value).length <= 20_000, {
        message: "customData is too large.",
      })
      .optional(),
  })
  .strict();

const callDateTime = z.string().trim().refine((value) => Number.isFinite(Date.parse(value)), {
  message: "Use a valid date and time.",
});
const callExpectationFields = {
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  expectedStatus: z.enum(["planned", "overdue", "in_progress", "completed", "cancelled"]).optional(),
};
const callBaseFields = {
  companyId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  entityType: z.enum(["lead", "opportunity", "party", "contact", "campaign", "general"]).default("general"),
  entityId: z.string().uuid().nullable().optional(),
  subject: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assignedTo: z.string().uuid().nullable().optional(),
  startAt: callDateTime.nullable().optional(),
  dueAt: callDateTime.nullable().optional(),
  reminderAt: callDateTime.nullable().optional(),
  direction: z.enum(["inbound", "outbound"]),
  phoneNumber: z.string().trim().max(40).nullable().optional(),
};

export const createCallSchema = z
  .object({
    ...callBaseFields,
    mode: z.enum(["schedule", "log"]).default("schedule"),
    occurredAt: callDateTime.optional(),
    durationSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
    outcomeCode: z.enum(["connected", "no_answer", "busy", "voicemail", "callback_requested", "wrong_number", "failed"]).optional(),
    outcome: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.entityType === "general" && input.entityId)
      context.addIssue({ code: "custom", path: ["entityId"], message: "General Calls cannot have a related-record ID." });
    if (input.entityType !== "general" && !input.entityId)
      context.addIssue({ code: "custom", path: ["entityId"], message: "Select the related CRM record." });
    if (input.mode === "schedule" && !input.dueAt)
      context.addIssue({ code: "custom", path: ["dueAt"], message: "Scheduled Calls require a due date and time." });
    if (input.mode === "log" && !input.outcomeCode)
      context.addIssue({ code: "custom", path: ["outcomeCode"], message: "Logged Calls require an outcome." });
    if (input.startAt && input.dueAt && Date.parse(input.startAt) > Date.parse(input.dueAt))
      context.addIssue({ code: "custom", path: ["dueAt"], message: "Due time cannot be earlier than start time." });
    if (input.reminderAt && input.dueAt && Date.parse(input.reminderAt) > Date.parse(input.dueAt))
      context.addIssue({ code: "custom", path: ["reminderAt"], message: "Reminder cannot be later than due time." });
  });

export const updateCallSchema = z
  .object({
    companyId: callBaseFields.companyId,
    branchId: callBaseFields.branchId,
    entityType: callBaseFields.entityType.optional(),
    entityId: callBaseFields.entityId,
    subject: callBaseFields.subject.optional(),
    description: callBaseFields.description,
    priority: callBaseFields.priority.optional(),
    assignedTo: callBaseFields.assignedTo,
    startAt: callBaseFields.startAt,
    dueAt: callBaseFields.dueAt,
    reminderAt: callBaseFields.reminderAt,
    direction: callBaseFields.direction.optional(),
    phoneNumber: callBaseFields.phoneNumber,
    ...callExpectationFields,
  })
  .strict();

export const callLifecycleSchema = z.object(callExpectationFields).strict();

export const completeCallSchema = z
  .object({
    outcomeCode: z.enum(["connected", "no_answer", "busy", "voicemail", "callback_requested", "wrong_number", "failed"]),
    outcome: z.string().trim().max(4000).nullable().optional(),
    ...callExpectationFields,
  })
  .strict();


const meetingDateTime = z.string().trim().refine((value) => Number.isFinite(Date.parse(value)), {
  message: "Use a valid date and time.",
});
const meetingExpectationFields = {
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  expectedStatus: z.enum(["planned", "overdue", "in_progress", "completed", "cancelled"]).optional(),
};
const meetingAttendeeSchema = z
  .object({
    contactId: z.string().uuid().nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    name: z.string().trim().max(200).nullable().optional(),
    responseStatus: z.enum(["needs_action", "accepted", "declined", "tentative"]).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.contactId && !input.email)
      context.addIssue({ code: "custom", path: ["email"], message: "Each attendee needs a Contact or email." });
  });
const meetingBaseFields = {
  companyId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  entityType: z.enum(["lead", "opportunity", "party", "contact", "campaign", "general"]).default("general"),
  entityId: z.string().uuid().nullable().optional(),
  subject: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assignedTo: z.string().uuid().nullable().optional(),
  startAt: meetingDateTime.nullable().optional(),
  endAt: meetingDateTime.nullable().optional(),
  locationType: z.enum(["in_person", "online", "phone", "other"]).default("other"),
  location: z.string().trim().max(500).nullable().optional(),
  meetingUrl: z.string().trim().url().max(2048).nullable().optional(),
  attendees: z.array(meetingAttendeeSchema).max(100).optional(),
};

export const createMeetingSchema = z
  .object({
    ...meetingBaseFields,
    mode: z.enum(["schedule", "log"]).default("schedule"),
    occurredAt: meetingDateTime.optional(),
    durationMinutes: z.coerce.number().int().min(0).max(1440).optional(),
    outcomeCode: z.enum(["held", "no_show"]).optional(),
    outcome: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.entityType === "general" && input.entityId)
      context.addIssue({ code: "custom", path: ["entityId"], message: "General Meetings cannot have a related-record ID." });
    if (input.entityType !== "general" && !input.entityId)
      context.addIssue({ code: "custom", path: ["entityId"], message: "Select the related CRM record." });
    if (input.mode === "schedule" && (!input.startAt || !input.endAt))
      context.addIssue({ code: "custom", path: ["startAt"], message: "Scheduled Meetings require start and end date/time." });
    if (input.startAt && input.endAt && Date.parse(input.endAt) <= Date.parse(input.startAt))
      context.addIssue({ code: "custom", path: ["endAt"], message: "Meeting end must be after start." });
    if (input.locationType === "in_person" && !input.location)
      context.addIssue({ code: "custom", path: ["location"], message: "In-person Meetings require a location." });
    if (input.locationType === "online" && !input.meetingUrl)
      context.addIssue({ code: "custom", path: ["meetingUrl"], message: "Online Meetings require a meeting URL." });
    if (input.mode === "log" && !input.outcomeCode)
      context.addIssue({ code: "custom", path: ["outcomeCode"], message: "Logged Meetings require an outcome." });
  });

export const updateMeetingSchema = z
  .object({
    companyId: meetingBaseFields.companyId,
    branchId: meetingBaseFields.branchId,
    entityType: meetingBaseFields.entityType.optional(),
    entityId: meetingBaseFields.entityId,
    subject: meetingBaseFields.subject.optional(),
    description: meetingBaseFields.description,
    priority: meetingBaseFields.priority.optional(),
    assignedTo: meetingBaseFields.assignedTo,
    startAt: meetingBaseFields.startAt,
    endAt: meetingBaseFields.endAt,
    locationType: meetingBaseFields.locationType.optional(),
    location: meetingBaseFields.location,
    meetingUrl: meetingBaseFields.meetingUrl,
    attendees: meetingBaseFields.attendees,
    ...meetingExpectationFields,
  })
  .strict();

export const meetingLifecycleSchema = z.object(meetingExpectationFields).strict();

export const completeMeetingSchema = z
  .object({
    outcomeCode: z.enum(["held", "no_show"]),
    outcome: z.string().trim().max(4000).nullable().optional(),
    ...meetingExpectationFields,
  })
  .strict();

// Prompt 6 (CRM-CAP-004): F016 Follow-ups and reminders.
const followUpDateTime = z.string().trim().refine((value) => Number.isFinite(Date.parse(value)), {
  message: "Use a valid date and time.",
});
const followUpExpectationFields = {
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  expectedStatus: z.enum(["planned", "overdue", "in_progress", "completed", "cancelled"]).optional(),
};
const followUpBaseFields = {
  companyId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  entityType: z.enum(["lead", "opportunity", "party", "contact", "campaign", "general"]).default("general"),
  entityId: z.string().uuid().nullable().optional(),
  subject: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueAt: followUpDateTime,
  followUpReason: z.string().trim().max(1000).nullable().optional(),
  followUpChannel: z.enum(["call", "email", "meeting", "whatsapp", "sms", "other"]).nullable().optional(),
  escalateAfterMinutes: z.coerce.number().int().min(1).max(43_200).nullable().optional(),
};
export const createFollowUpSchema = z
  .object({
    ...followUpBaseFields,
    reminderOffsets: z.array(z.coerce.number().int().min(0).max(43_200)).max(10).optional(),
    reminderChannel: z.enum(["in_app", "email"]).default("in_app"),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.entityType === "general" && input.entityId)
      context.addIssue({ code: "custom", path: ["entityId"], message: "General Follow-ups cannot have a related-record ID." });
    if (input.entityType !== "general" && !input.entityId)
      context.addIssue({ code: "custom", path: ["entityId"], message: "Select the related CRM record." });
  });
export const updateFollowUpSchema = z
  .object({
    companyId: followUpBaseFields.companyId,
    branchId: followUpBaseFields.branchId,
    entityType: followUpBaseFields.entityType.optional(),
    entityId: followUpBaseFields.entityId,
    subject: followUpBaseFields.subject.optional(),
    description: followUpBaseFields.description,
    assignedTo: followUpBaseFields.assignedTo,
    dueAt: followUpBaseFields.dueAt.optional(),
    followUpReason: followUpBaseFields.followUpReason,
    followUpChannel: followUpBaseFields.followUpChannel,
    escalateAfterMinutes: followUpBaseFields.escalateAfterMinutes,
    ...followUpExpectationFields,
  })
  .strict();
export const followUpLifecycleSchema = z.object(followUpExpectationFields).strict();
export const snoozeFollowUpSchema = z
  .object({ dueAt: followUpDateTime, ...followUpExpectationFields })
  .strict();
