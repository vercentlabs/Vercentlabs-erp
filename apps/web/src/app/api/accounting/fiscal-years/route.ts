import { z } from "zod";

import { createFiscalYear, listFiscalYears } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// Financial years with their monthly periods and each period's status.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ years: await listFiscalYears(client, context) }));
}

const schema = z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), withAdjustmentPeriod: z.boolean().optional() });

export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ year: await createFiscalYear(client, context, input) }), 201, "accounting.period.manage");
}
