import { z } from "zod";

import { assertSameOrigin, clientIp, enforceRateLimit, isAuthMailerConfigured, requestPasswordReset } from "@vercentlabs/api";

import { withIngressClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const body = schema.parse(await readJson(request));
    await withIngressClient((client) => enforceRateLimit(client, `forgot-password:${clientIp(request, process.env)}`, 5, 300));
    // requestPasswordReset returns the identical shape whether or not the
    // email is registered — this route must not branch on that either,
    // or it reintroduces the account-enumeration hole the function itself
    // was written to avoid.
    await withIngressClient((client) => requestPasswordReset(client, body.email));
    // deliveryConfigured reflects a deployment-wide fact (is any transport
    // configured at all), not this specific request's delivery outcome —
    // identical for every caller regardless of the target email, so it
    // cannot be used to infer whether an address is registered.
    return ok({ requested: true, deliveryConfigured: isAuthMailerConfigured(process.env) });
  } catch (error) {
    return errorResponse(error);
  }
}
