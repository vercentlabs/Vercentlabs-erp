import { publicQuoteTokenHash, resolvePublicQuoteOrganization, resolvePublicQuoteToken } from "@vercentlabs/api";

import { tenantTransaction, withIngressClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { toWire } from "@/features/sales/shared/wire";

type RouteContext = { params: Promise<{ token: string }> };

// Public, unauthenticated by design: a customer opening the link a salesperson
// sent them. The URL token is the credential (only its SHA-256 is stored); the
// organisation is resolved from that hash alone, then the SAME domain function
// the authenticated flow uses enforces link expiry, revocation, "a newer
// revision exists" and the quote's own valid-until.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const tokenHash = publicQuoteTokenHash(token);
    const organizationId = await withIngressClient((client) => resolvePublicQuoteOrganization(client, tokenHash));
    const result = await tenantTransaction(organizationId, (client) => resolvePublicQuoteToken(client, { organizationId } as never, tokenHash, true));
    return ok(toWire({ quotation: result.quotation, expiresAt: result.link.expires_at }));
  } catch (error) {
    return errorResponse(error);
  }
}
