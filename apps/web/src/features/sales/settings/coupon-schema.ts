import { z } from "zod";

// A coupon as Setup sends it (Sales report Phase 3).
export const couponSchema = z.object({
  code: z.string().trim().min(3).max(30), description: z.string().trim().max(200).nullish(), discountType: z.enum(["amount", "percent"]), value: z.number().positive(),
  maximumDiscount: z.number().positive().nullish(), minimumOrder: z.number().min(0).nullish(), validFrom: z.string().date().nullish(), validTo: z.string().date().nullish(),
  usesTotal: z.number().int().positive().nullish(), usesPerCustomer: z.number().int().positive().nullish(),
});
