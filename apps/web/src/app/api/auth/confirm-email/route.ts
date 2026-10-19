import { z } from "zod";

import { assertSameOrigin, confirmEmailChange } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";

const schema = z.object({ token: z.string().min(1).max(500) });

// The link from the new address of an email change (public: the person may open it signed out).
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const body = schema.parse(await readJson(request));
    const result = await ingressTransaction((client) => confirmEmailChange(client, body.token));
    return ok({ confirmed: true, email: result.email });
  } catch (error) {
    return errorResponse(error);
  }
}
