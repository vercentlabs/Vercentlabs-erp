import { z } from "zod";

// A recurring schedule as the order page sends it (Sales report Phase 3).
export const recurringScheduleSchema = z.object({
  intervalMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]), dayOfMonth: z.number().int().min(1).max(28), startDate: z.string().date(),
  endDate: z.string().date().nullish(), makes: z.enum(["order", "invoice"]), autoSend: z.boolean().optional(),
});
