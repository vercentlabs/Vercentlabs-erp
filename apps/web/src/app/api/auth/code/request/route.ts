import { z } from "zod";

import { assertSameOrigin, clientIp, enforceRateLimit, requestSignInCode } from "@vercentlabs/api";

import { ingressTransaction, withIngressClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

// Sign-in, step 1: a code to the email. The answer is the same whether or not the email has a workspace.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const { email } = schema.parse(await readJson(request));
    await withIngressClient((client) => enforceRateLimit(client, `login-code:${clientIp(request, process.env)}`, 10, 300));
    return ok(await ingressTransaction((client) => requestSignInCode(client, email, process.env)));
  } catch (error) {
    return errorResponse(error);
  }
}
