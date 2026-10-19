import { z } from "zod";
import { applyReferenceRates } from "@vercentlabs/api";

export const JOB_TYPE = "platform.exchange_rates.feed";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Once a day: the reference rates from EXCHANGE_RATE_FEED_URL for the company's active currencies (nothing when no feed is set).
export async function exchangeRateFeedHandler(client, systemContext) {
  return applyReferenceRates(client, systemContext.organizationId);
}
