import { z } from "zod";

import {
  acknowledgeCloseCheck, closePeriod, lockPeriod, reopenPeriod, returnPeriodToOpen, startPeriodReview, withdrawCloseAcknowledgement,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ periodId: string; action: string }> };
const schema = z.object({ note: z.string().max(1000).optional(), reason: z.string().trim().max(500).optional(), checkKey: z.string().max(60).optional() });

// review · back-to-open · close · lock · reopen (with a reason) · acknowledge / withdraw (a warning check). The rules are the domain's.
export async function POST(request: Request, { params }: Params) {
  const { periodId, action } = await params;
  return accountingMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "review": return { workspace: await startPeriodReview(client, context, periodId, { note: input.note }) };
      case "back-to-open": return { workspace: await returnPeriodToOpen(client, context, periodId, { note: input.note }) };
      case "close": return { workspace: await closePeriod(client, context, periodId, { note: input.note }) };
      case "lock": return { workspace: await lockPeriod(client, context, periodId) };
      case "reopen": return { workspace: await reopenPeriod(client, context, periodId, { reason: input.reason ?? "" }) };
      case "acknowledge": return { workspace: await acknowledgeCloseCheck(client, context, periodId, { checkKey: input.checkKey ?? "", reason: input.reason ?? "" }) };
      case "withdraw": return { workspace: await withdrawCloseAcknowledgement(client, context, periodId, { checkKey: input.checkKey ?? "" }) };
      default: throw new HttpError(404, "Unknown period action.");
    }
  });
}
