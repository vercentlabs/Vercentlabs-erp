import { setExchangeRateStatus } from "@vercentlabs/api";
import { z } from "zod";

import { termsWrite } from "@/features/settings/finance-commercial/payment-terms/server/terms-http";

// Body: { status: active | inactive }. An inactive rate is skipped; the one before it applies again.
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return termsWrite(request, "exchange_rates.manage", z.object({ status: z.enum(["active", "inactive"]) }), async (client, context, input) =>
    ({ rate: await setExchangeRateStatus(client, context, id, input.status) }));
}
