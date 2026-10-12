import { z } from "zod";

import { recordZReportAdjustment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ reportId: string }> };

// POST: record a correction found after the close, beside the report.
const schema = z.object({
  category: z.enum(["INVOICE_CORRECTION", "INVENTORY_CORRECTION", "FINANCE_CORRECTION", "LATE_PAYMENT_OUTCOME", "LATE_REFUND_OUTCOME", "CASH_DIFFERENCE_RESOLVED", "OTHER"]),
  sourceType: z.string().trim().min(1).max(60),
  sourceId: z.string().uuid().optional(),
  monetaryEffect: z.string().trim().regex(/^-?\d{1,14}(\.\d{1,2})?$/).optional(),
  description: z.string().trim().min(1).max(500),
  financeReference: z.string().trim().max(120).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { reportId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ adjustment: await recordZReportAdjustment(client, context, reportId, input) }), 201, "pos.view");
}
