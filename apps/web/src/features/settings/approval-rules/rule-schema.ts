import { z } from "zod";

// Request shape for an approval rule (checked again by the platform service).
export const ruleSchema = z.object({
  documentType: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  minAmount: z.union([z.string().max(30), z.number().min(0)]),
  level: z.number().int().min(1).max(2),
  approverUserId: z.string().uuid().nullable().optional(),
  approverRoleId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});
