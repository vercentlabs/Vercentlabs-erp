import { z } from "zod";

// A rate contract as the routes accept it (Sales audit).
export const rateContractSchema = z.object({
  partyId: z.string().uuid().optional(),
  name: z.string().max(160).optional(),
  customerReference: z.string().max(120).nullish(),
  currencyCode: z.string().length(3).optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(2000).nullish(),
  lines: z.array(z.object({ itemId: z.string().uuid(), rate: z.number().min(0), contractedQuantity: z.number().positive() })).max(500).optional(),
});
