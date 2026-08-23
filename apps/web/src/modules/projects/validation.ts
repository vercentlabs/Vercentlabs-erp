import { z } from "zod";

const uuid = z.string().uuid();

export const projectCreateSchema = z.object({
  projectNumber: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10000).nullish(),
  branchId: uuid.nullish(),
  customerId: uuid.nullish(),
  salesOrderId: uuid.nullish(),
  contractReference: z.string().max(200).nullish(),
  projectManagerId: uuid.nullish(),
  billingMethod: z
    .enum(["fixed_price", "time_and_material", "milestone", "non_billable"])
    .default("non_billable"),
  currencyCode: z.string().trim().length(3).default("INR"),
  plannedStartDate: z.string().date().nullish(),
  plannedEndDate: z.string().date().nullish(),
  approvedBudget: z.coerce.number().min(0).default(0),
  contractedRevenue: z.coerce.number().min(0).default(0),
  billable: z.boolean().default(false),
});

export const taskCreateSchema = z.object({
  projectId: uuid,
  milestoneId: uuid.nullish(),
  parentTaskId: uuid.nullish(),
  taskNumber: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(300),
  description: z.string().max(10000).nullish(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assigneeUserId: uuid.nullish(),
  plannedStartDate: z.string().date().nullish(),
  plannedEndDate: z.string().date().nullish(),
  estimatedHours: z.coerce.number().min(0).default(0),
  billable: z.boolean().default(false),
});

export const timeEntryCreateSchema = z.object({
  projectId: uuid,
  taskId: uuid.nullish(),
  userId: uuid.nullish(),
  workDate: z.string().date(),
  hours: z.coerce.number().positive().max(24),
  description: z.string().max(2000).nullish(),
  billable: z.boolean().default(false),
  costRate: z.coerce.number().min(0).default(0),
  billRate: z.coerce.number().min(0).default(0),
});

export const projectActionSchema = z.object({
  action: z.enum(["plan", "activate", "hold", "resume", "complete", "cancel"]),
});
