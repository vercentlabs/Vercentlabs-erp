import { listExchangeRates, setExchangeRate } from "@vercentlabs/api";
import { z } from "zod";

import { termsRead, termsWrite } from "@/features/settings/finance-commercial/payment-terms/server/terms-http";

// Settings → Exchange rates: the rates (?currency, status) with each currency's rate in force today.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return termsRead(request, "exchange_rates.view", async (client, context) =>
    await listExchangeRates(client, context, { currency: url.searchParams.get("currency") ?? undefined, status: url.searchParams.get("status") ?? undefined }));
}

const rateSchema = z.object({ fromCurrencyCode: z.string().max(3), toCurrencyCode: z.string().max(3).optional(), rateDate: z.string().max(10), rate: z.union([z.number(), z.string().max(40)]) });

// Body: { fromCurrencyCode, toCurrencyCode?, rateDate, rate }. Sets the rate for that day (replacing one already set).
export async function POST(request: Request) {
  return termsWrite(request, "exchange_rates.manage", rateSchema, async (client, context, input) => ({ rate: await setExchangeRate(client, context, input) }), 201);
}
