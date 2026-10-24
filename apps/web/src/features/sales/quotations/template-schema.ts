import { z } from "zod";

// A quotation template as Setup sends it (Sales report Phase 2).
export const quotationTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullish(),
  validityDays: z.number().int().min(1).max(365).nullish(),
  paymentTermId: z.string().uuid().nullish(),
  termsAndConditions: z.string().max(20000).nullish(),
  customerNotes: z.string().max(10000).nullish(),
  lines: z.array(z.object({
    itemId: z.string().uuid(), quantity: z.number().positive(), uomId: z.string().uuid().nullish(), description: z.string().max(2000).nullish(),
    discountType: z.enum(["percent", "amount"]).optional(), discountValue: z.number().min(0).optional(),
  })).max(200).optional(),
  sectionLines: z.array(z.object({ kind: z.enum(["section", "note"]), text: z.string().trim().min(1).max(1000), position: z.number().int().min(0).max(200) })).max(100).optional(),
});
