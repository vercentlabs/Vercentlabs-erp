import { z } from "zod";

// A commission rule as the routes accept it (Sales audit).
export const commissionRuleSchema = z.object({
  name: z.string().max(120),
  ratePercent: z.number().min(0).max(100),
  basis: z.enum(["net_sales", "gross_margin"]),
  ownerUserId: z.string().uuid().nullish(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
