import {
  captureQuotationGovernanceSnapshot,
  createQuotation,
  listQuotations,
} from "@vercentlabs/api";

import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { rethrowSalesError } from "@/lib/sales";
import { salesSession, tenantTransaction } from "@/lib/sales-route";
import { salesDocumentSchema } from "@/lib/sales-validation";

export async function GET(request: Request) {
  try {
    const { context } = await salesSession();
    const filters = Object.fromEntries(
      new URL(request.url).searchParams.entries(),
    );
    const quotations = await tenantTransaction(
      context.organizationId,
      (client) => listQuotations(client, context, filters),
    );
    return ok({ quotations });
  } catch (error) {
    try {
      rethrowSalesError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session, context } = await salesSession(true);
    const input = salesDocumentSchema
      .extend({ validUntil: salesDocumentSchema.shape.validUntil.unwrap() })
      .parse(await readJson(request));
    const quotation = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const created = await createQuotation(client, context, input);
        await captureQuotationGovernanceSnapshot(
          client,
          context,
          String(created.id),
          "created",
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "sales.quotation.created",
          entityType: "sales_quotation",
          entityId: String(created.id),
          afterData: input,
          request,
          client,
        });
        return created;
      },
    );
    return ok({ quotation, message: "Quotation created." }, 201);
  } catch (error) {
    try {
      rethrowSalesError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
