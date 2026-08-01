import {
  captureQuotationGovernanceSnapshot,
  getQuotation,
  reviseQuotation,
} from "@vercentlabs/api";

import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { rethrowSalesError } from "@/lib/sales";
import { salesSession, tenantTransaction } from "@/lib/sales-route";
import { salesDocumentSchema } from "@/lib/sales-validation";

export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const { context } = await salesSession();
    const { id } = await route.params;
    const quotation = await tenantTransaction(
      context.organizationId,
      (client) => getQuotation(client, context, id),
    );
    return ok({ quotation });
  } catch (error) {
    try {
      rethrowSalesError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { session, context } = await salesSession(true);
    const { id } = await route.params;
    const input = salesDocumentSchema
      .extend({ validUntil: salesDocumentSchema.shape.validUntil.unwrap() })
      .parse(await readJson(request));
    const version = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const result = await reviseQuotation(client, context, id, input);
        await captureQuotationGovernanceSnapshot(
          client,
          context,
          id,
          "revised",
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "sales.quotation.revised",
          entityType: "sales_quotation",
          entityId: id,
          afterData: {
            versionId: result.id,
            revisionReason: input.revisionReason,
          },
          request,
          client,
        });
        return result;
      },
    );
    return ok({ version, message: "Quotation revised." });
  } catch (error) {
    try {
      rethrowSalesError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
