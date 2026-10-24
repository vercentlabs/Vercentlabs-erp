import { z } from "zod";

// A delivery method as Setup sends it (Sales report Phase 3).
export const deliveryMethodSchema = z.object({
  name: z.string().trim().min(1).max(120), basis: z.enum(["fixed", "per_kg", "percent"]), rate: z.number().min(0), minimumCharge: z.number().min(0).nullish(),
  freeAbove: z.number().min(0).nullish(), stateCodes: z.array(z.string().regex(/^\d{2}$/)).max(40).optional(),
});
