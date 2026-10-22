import { z } from "zod";

// A beat as Setup › Beats saves it (Sales plan, Phase 4).
export const beatSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  salespersonUserId: z.string().uuid().nullish(),
  visitDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
