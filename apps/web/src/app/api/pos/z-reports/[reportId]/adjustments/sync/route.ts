import { z } from "zod";

import { syncZReportAdjustments } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ reportId: string }> };

// POST: link what has moved on since the close (a refund that completed, a payment that resolved, a difference settled).
const schema = z.object({});

export async function POST(request: Request, { params }: Params) {
  const { reportId } = await params;
  return posMutation(request, schema, async (client, context) => ({ adjustments: await syncZReportAdjustments(client, context, reportId) }), 200, "pos.view");
}
