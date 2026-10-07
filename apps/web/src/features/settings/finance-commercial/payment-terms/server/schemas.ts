import { z } from "zod";

// What the Payment Terms routes accept: a term (its type, rules, advance and scope) and a preview request.
export const ruleSchema = z.object({
  percentage: z.union([z.string(), z.number()]).transform(String),
  basis: z.enum(["invoice_date", "invoice_received", "posting_date"]).optional(),
  kind: z.enum(["days", "end_of_month", "fixed_day"]).optional(),
  days: z.union([z.number(), z.string()]).optional(),
  monthsOffset: z.union([z.number(), z.string()]).optional(),
  dayOfMonth: z.union([z.number(), z.string()]).nullable().optional(),
});

export const termSchema = z.object({
  code: z.string().trim().min(1).max(30).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  termType: z.enum(["immediate", "net_days", "invoice_receipt", "end_of_month", "fixed_day", "installments", "advance", "custom"]).optional(),
  rules: z.array(ruleSchema).max(12).optional(),
  advancePercentage: z.union([z.string(), z.number()]).nullable().optional(),
  buyingRegistrationId: z.string().uuid().nullable().optional(),
  salesEnabled: z.boolean().optional(),
  purchaseEnabled: z.boolean().optional(),
  newVersion: z.boolean().optional(),
  versionReason: z.string().max(500).optional(),
});

export const previewSchema = z.object({
  termId: z.string().uuid().optional(),
  termType: z.string().optional(),
  rules: z.array(ruleSchema).max(12).optional(),
  advancePercentage: z.union([z.string(), z.number()]).nullable().optional(),
  total: z.union([z.string(), z.number()]).transform(String),
  invoiceDate: z.string(),
  invoiceReceivedDate: z.string().optional(),
  postingDate: z.string().optional(),
});

export const defaultsSchema = z.object({ direction: z.enum(["sales", "purchase"]), termId: z.string().uuid().nullable() });
export const emptySchema = z.object({}).passthrough();
