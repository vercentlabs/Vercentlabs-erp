import { z } from "zod";

// Request shape for creating/updating an automation (validated again, and
// more strictly, by the platform workflow service).
const condition = z.object({
  field: z.string().max(80),
  operator: z.enum(["equals", "not_equals", "in", "changed_includes", "greater_than", "less_than"]),
  value: z.union([z.string().max(200), z.array(z.string().max(200)).max(50)]),
});
const notify = z.object({
  type: z.literal("notify"),
  recipient: z.union([
    z.object({ type: z.literal("event_field"), field: z.string().max(80) }),
    z.object({ type: z.literal("user"), userId: z.string().uuid() }),
  ]),
  title: z.string().trim().min(1).max(120),
  message: z.string().max(500),
});
const person = z.union([
  z.object({ type: z.literal("event_field"), field: z.string().max(80) }),
  z.object({ type: z.literal("user"), userId: z.string().uuid() }),
]);
// CRM's own actions (CRM plan 4.6), for CRM lead and deal events; email, activity and hand-over for every app (Shared Platform plan 6).
const action = z.discriminatedUnion("type", [
  notify,
  z.object({
    type: z.literal("send_email"),
    to: z.union([person.options[0], person.options[1], z.object({ type: z.literal("address"), email: z.string().email().max(200) })]),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4000),
  }),
  z.object({ type: z.literal("create_activity"), activityType: z.enum(["to_do", "call", "meeting", "email"]), summary: z.string().trim().min(1).max(300), inDays: z.number().int().min(0).max(365), assignee: person }),
  z.object({ type: z.literal("assign"), userId: z.string().uuid() }),
  z.object({
    type: z.literal("crm.create_follow_up"),
    followUpType: z.string().max(20),
    inHours: z.number().min(0).max(2160),
    subject: z.string().max(200).optional(),
    assignee: z.union([
      z.object({ type: z.literal("record_owner") }),
      z.object({ type: z.literal("user"), userId: z.string().uuid() }),
      z.object({ type: z.literal("event_field"), field: z.string().max(80) }),
    ]),
  }),
  z.object({ type: z.literal("crm.assign_owner"), userId: z.string().uuid() }),
  z.object({ type: z.literal("crm.set_priority"), priority: z.enum(["low", "medium", "high"]) }),
  z.object({ type: z.literal("crm.add_tag"), tag: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal("crm.send_email"), templateId: z.string().uuid() }),
  z.object({ type: z.literal("crm.notify_followers"), title: z.string().trim().min(1).max(120), message: z.string().max(500).optional() }),
  z.object({ type: z.literal("crm.create_task"), subject: z.string().trim().min(1).max(200), inDays: z.number().int().min(0).max(365), priority: z.enum(["low", "medium", "high"]),
    assignee: z.union([z.object({ type: z.literal("record_owner") }), z.object({ type: z.literal("user"), userId: z.string().uuid() })]) }),
  z.object({ type: z.literal("crm.move_stage"), stageCode: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal("crm.send_whatsapp"), templateName: z.string().trim().min(1).max(512), templateLanguage: z.string().max(10), parameters: z.array(z.string().max(200)).max(10) }),
  z.object({ type: z.literal("crm.call_webhook"), subscriptionId: z.string().uuid() }),
]);
export const workflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: z.string().max(120),
  offsetDays: z.number().int().min(-90).max(365).optional(),
  conditions: z.array(condition).max(10).default([]),
  actions: z.array(action).min(1).max(5),
  status: z.enum(["active", "inactive"]).optional(),
  expectedVersion: z.number().int().min(1).optional(),
});
