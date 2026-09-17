import { z } from "zod";

import { assertSameOrigin, consumeEmailVerificationToken } from "@vercentlabs/api";

import { transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";

const schema = z.object({ token: z.string().min(1).max(500) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const body = schema.parse(await readJson(request));
    // transaction(), not withClient() — the token claim and the user's
    // email_verified_at update must commit or roll back together.
    const result = await transaction((client) => consumeEmailVerificationToken(client, body.token));
    return ok({ verified: true, userId: result.userId });
  } catch (error) {
    return errorResponse(error);
  }
}
