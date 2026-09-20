import { createHash } from "node:crypto";
import { z } from "zod";

import { recordPublicQuoteDecision } from "@vercentlabs/api";

import { query, tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
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
// once, against the exact version the customer was shown.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, "Quotation link not found.");
    const input = schema.parse(await readJson(request));
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const rows = await query<{ organization_id: string }>("SELECT organization_id FROM public.sales_public_quote_tokens WHERE token_hash=$1", [tokenHash]);
    const found = rows[0];
    if (!found) throw new HttpError(404, "Quotation link not found.");
    const metadata = {
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: request.headers.get("user-agent")?.slice(0, 500) || null,
    };
    const result = await tenantTransaction(found.organization_id, (client) =>
      recordPublicQuoteDecision(client, { organizationId: found.organization_id } as never, tokenHash, input, metadata),
    );
    return ok(toWire({ result }) as Record<string, unknown>, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
