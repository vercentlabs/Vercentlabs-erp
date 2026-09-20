import { createHash } from "node:crypto";

import { resolvePublicQuoteToken } from "@vercentlabs/api";

import { query, tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { toWire } from "@/features/sales/shared/wire";

type RouteContext = { params: Promise<{ token: string }> };

// Public, unauthenticated by design: a customer opening the link a salesperson
// sent them. The token is 32 random bytes (base64url); only its SHA-256 is ever
// stored, so the URL itself is the credential and cannot be looked up by
// guessing an id. The organisation is resolved from that hash, then the SAME
// domain function the authenticated flow uses does the rest -- link expiry,
// revocation, "a newer revision exists" and the quote's own valid-until are all
// enforced there, not re-implemented here.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, "Quotation link not found.");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const rows = await query<{ organization_id: string }>("SELECT organization_id FROM public.sales_public_quote_tokens WHERE token_hash=$1", [tokenHash]);
    const found = rows[0];
    if (!found) throw new HttpError(404, "Quotation link not found.");
    const result = await tenantTransaction(found.organization_id, (client) => resolvePublicQuoteToken(client, { organizationId: found.organization_id } as never, tokenHash, true));
    return ok(toWire({ quotation: result.quotation, expiresAt: result.link.expires_at }));
  } catch (error) {
    return errorResponse(error);
  }
}
