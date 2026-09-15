import { createHash } from "node:crypto";
import { z } from "zod";

import { errorResponse, HttpError, ok } from "@/core/http";
import { readRequestBytes } from "@/core/security";
import { recordInboundMailEvent, verifyInboundMailSignature } from "@/core/shared-platform";

const schema = z.object({
  organizationId: z.string().uuid(),
  provider: z.string().trim().min(1).max(80),
  providerMessageId: z.string().trim().min(1).max(240),
  routeKey: z.string().trim().min(1).max(160),
  sender: z.string().trim().max(500).optional(),
  subject: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await readRequestBytes(request, 256_000);
    verifyInboundMailSignature(body, request.headers.get("x-vercentlabs-signature"));
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder().decode(body)); } catch { throw new HttpError(400, "Inbound mail payload must be valid JSON."); }
    const input = schema.parse(parsed);
    const result = await recordInboundMailEvent({ ...input, payloadDigest: createHash("sha256").update(body).digest("hex") });
    return ok({ ...result }, result.replayed ? 200 : 202);
  } catch (error) {
    return errorResponse(error);
  }
}
