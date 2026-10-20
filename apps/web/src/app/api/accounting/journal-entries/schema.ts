import { z } from "zod";

const amount = z.string().trim().regex(/^\d{0,15}(\.\d{0,6})?$/, "Enter an amount such as 1250.50").optional();
const id = z.string().uuid().nullable().optional();

// A manual journal as the form sends it. The domain checks the accounts, the balance, the period and every reference.
export const manualJournalSchema = z.object({
  journalId: z.string().uuid().optional(), accountingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reference: z.string().max(200).nullable().optional(), description: z.string().trim().max(1000).optional(), currencyCode: z.string().length(3).optional(),
  exchangeRate: z.string().regex(/^\d{0,12}(\.\d{0,10})?$/).optional(), entryType: z.enum(["standard", "adjustment", "accrual", "deferral"]).optional(),
  expectedUpdatedAt: z.string().optional(),
  lines: z.array(z.object({
    accountId: z.string().uuid(), description: z.string().max(1000).nullable().optional(), debit: amount, credit: amount,
    departmentId: id, costCenterId: id, partyId: id,
    dimensions: z.array(z.object({ dimensionId: z.string().uuid(), dimensionValueId: z.string().uuid() })).max(20).optional(),
  })).max(500).optional(),
});
