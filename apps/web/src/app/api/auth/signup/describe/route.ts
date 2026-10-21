import { z } from "zod";

import { assertSameOrigin, describeSignupBusiness } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { readSignupToken } from "@/features/auth/signup-cookie";

const schema = z.object({ description: z.string().max(200) });

// Screen 3 (and Edit on Screen 4): the person's own line, and the apps suggested from it.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const { description } = schema.parse(await readJson(request));
    const token = (await readSignupToken()) ?? "";
    return ok({ state: await ingressTransaction((client) => describeSignupBusiness(client, token, description, { env: process.env })) });
  } catch (error) {
    return errorResponse(error);
  }
}
