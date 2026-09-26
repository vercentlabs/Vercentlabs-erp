import { z } from "zod";

// Request shape for creating/updating an automation (validated again, and
// more strictly, by the platform workflow service).
const condition = z.object({ field: z.string().max(80), operator: z.enum(["equals", "not_equals", "in", "changed_includes"]), value: z.union([z.string().max(200), z.array(z.string().max(200)).max(50)]) });
const action = z.object({
  type: z.literal("notify"),
  recipient: z.union([z.object({ type: z.literal("event_field"), field: z.string().max(80) }), z.object({ type: z.literal("user"), userId: z.string().uuid() })]),
  title: z.string().trim().min(1).max(120),
  message: z.string().max(500),
});
export const workflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: z.string().max(120),
  conditions: z.array(condition).max(10).default([]),
  actions: z.array(action).min(1).max(5),
  status: z.enum(["active", "inactive"]).optional(),
  expectedVersion: z.number().int().min(1).optional(),
});
