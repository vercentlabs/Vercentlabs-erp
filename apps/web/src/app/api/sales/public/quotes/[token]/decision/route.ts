import { z } from "zod";

import { clientIp, publicQuoteTokenHash, recordPublicQuoteDecision, resolvePublicQuoteOrganization } from "@vercentlabs/api";

import { tenantTransaction, withIngressClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { toWire } from "@/features/sales/shared/wire";

type RouteContext = { params: Promise<{ token: string }> };

const schema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email().max(320).optional().or(z.literal("")),
  customerTitle: z.string().trim().max(160).optional(),
  typedSignature: z.string().trim().max(300).optional(),
  note: z.string().trim().max(4000).optional(),
});

// Records the customer's accept/decline. The domain function refuses a second
// decision, an expired or revoked link, and a quote that was revised after the
// link was sent -- an accepted decision is evidence, so it can only be made
// once, against the exact version the customer was shown. The client address
// comes from the trusted proxy configuration, never a raw forwarded header.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const tokenHash = publicQuoteTokenHash(token);
    const input = schema.parse(await readJson(request));
    const organizationId = await withIngressClient((client) => resolvePublicQuoteOrganization(client, tokenHash));
    const address = clientIp(request, process.env);
    const metadata = {
      ipAddress: ["unavailable", "local"].includes(address) ? null : address,
      userAgent: request.headers.get("user-agent")?.slice(0, 500) || null,
    };
    const result = await tenantTransaction(organizationId, (client) => recordPublicQuoteDecision(client, { organizationId } as never, tokenHash, input, metadata));
    return ok(toWire({ result }) as Record<string, unknown>, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
