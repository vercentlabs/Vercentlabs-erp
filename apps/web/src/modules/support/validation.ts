import { z } from "zod";

const uuid = z.string().uuid();

export const supportQueueCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullish(),
  managerUserId: uuid.nullish(),
  assignmentStrategy: z
    .enum(["manual", "round_robin", "least_loaded", "skills_based"])
    .default("manual"),
  businessHours: z.record(z.string(), z.unknown()).default({}),
});

export const supportSlaCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullish(),
  priority: z.enum(["low", "normal", "high", "urgent", "critical"]).nullish(),
  firstResponseMinutes: z.coerce.number().int().positive(),
  resolutionMinutes: z.coerce.number().int().positive(),
  pauseOnPendingCustomer: z.boolean().default(true),
  businessHoursOnly: z.boolean().default(true),
});

export const supportTicketCreateSchema = z.object({
  ticketNumber: z.string().max(100).optional(),
  branchId: uuid.nullish(),
  subject: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(20000),
  channel: z
    .enum(["web", "email", "phone", "chat", "whatsapp", "social", "internal"])
    .default("web"),
  categoryId: uuid.nullish(),
  queueId: uuid.nullish(),
  assignedUserId: uuid.nullish(),
  customerId: uuid.nullish(),
  contactId: uuid.nullish(),
  customerName: z.string().max(200).nullish(),
  customerEmail: z.string().email().nullish(),
  customerPhone: z.string().max(50).nullish(),
  relatedCrmRecordType: z.string().max(100).nullish(),
  relatedCrmRecordId: uuid.nullish(),
  relatedSalesOrderId: uuid.nullish(),
  relatedInvoiceId: uuid.nullish(),
  relatedAssetId: uuid.nullish(),
  relatedProjectId: uuid.nullish(),
  relatedQualityRecordType: z.string().max(100).nullish(),
  relatedQualityRecordId: uuid.nullish(),
  priority: z
    .enum(["low", "normal", "high", "urgent", "critical"])
    .default("normal"),
  slaPolicyId: uuid.nullish(),
  sourceReference: z.string().max(300).nullish(),
});

export const supportTicketActionSchema = z
  .object({
    action: z.enum([
      "open",
      "pending_customer",
      "pending_internal",
      "resume_from_customer",
      "resume_from_internal",
      "resolve",
      "close",
      "reopen",
      "cancel",
      "assign",
    ]),
  })
  .passthrough();

export const supportCommunicationCreateSchema = z.object({
  direction: z.enum(["inbound", "outbound", "internal"]),
  channel: z.enum([
    "web",
    "email",
    "phone",
    "chat",
    "whatsapp",
    "social",
    "internal",
  ]),
  subject: z.string().max(500).nullish(),
  body: z.string().trim().min(1).max(50000),
  senderName: z.string().max(200).nullish(),
  senderAddress: z.string().max(300).nullish(),
  recipientAddress: z.string().max(300).nullish(),
  externalMessageId: z.string().max(300).nullish(),
  privateNote: z.boolean().default(false),
});
