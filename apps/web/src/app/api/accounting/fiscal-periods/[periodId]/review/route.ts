import { z } from "zod";

import { setPeriodReview } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ periodId: string }> };

// Open <-> Closing review. Closing and locking go through a close run.
export async function POST(request: Request, { params }: Params) {
  const { periodId } = await params;
  return accountingMutation(request, z.object({ review: z.boolean(), note: z.string().max(1000).optional() }), async (client, context, input) => ({
    period: await setPeriodReview(client, context, periodId, input),
  }), 200, "accounting.period.manage");
}
