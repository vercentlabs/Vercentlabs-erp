import { z } from "zod";

// A payment reminder rule as Setup sends it.
export const reminderRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  daysOffset: z.number().int().min(-60).max(365),
  sendEmail: z.boolean(),
  sendWhatsApp: z.boolean(),
  whatsappTemplate: z.string().trim().max(120).nullish(),
  whatsappLanguage: z.string().trim().max(10).optional(),
  subject: z.string().trim().max(200).nullish(),
  message: z.string().max(4000).nullish(),
});
