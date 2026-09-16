import { z } from "zod";

import { assertSameOrigin, clientIp, enforceRateLimit, requestPasswordReset } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const body = schema.parse(await readJson(request));
    await withClient((client) => enforceRateLimit(client, `forgot-password:${clientIp(request, process.env)}`, 5, 300));
    // requestPasswordReset returns the identical shape whether or not the
    // email is registered — this route must not branch on that either,
    // or it reintroduces the account-enumeration hole the function itself
    // was written to avoid.
    await withClient((client) => requestPasswordReset(client, body.email));
    return ok({ requested: true });
  } catch (error) {
    return errorResponse(error);
  }
}
