import { z } from "zod";

import { assertSameOrigin, consumeEmailVerificationToken } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";

const schema = z.object({ token: z.string().min(1).max(500) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const body = schema.parse(await readJson(request));
    const result = await withClient((client) => consumeEmailVerificationToken(client, body.token));
    return ok({ verified: true, userId: result.userId });
  } catch (error) {
    return errorResponse(error);
  }
}
