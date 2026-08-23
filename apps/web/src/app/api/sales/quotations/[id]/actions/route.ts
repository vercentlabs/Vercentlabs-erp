import {
  captureQuotationGovernanceSnapshot,
  convertQuotationToOrder,
  recordPublicQuoteDecision,
  sendQuotation,
  submitQuotation,
} from "@vercentlabs/api";

import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { rethrowSalesError } from "@/modules/sales";
import { salesSession, tenantTransaction } from "@/modules/sales/server";
import { salesActionSchema } from "@/modules/sales/validation";

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { session, context } = await salesSession(true);
    const { id } = await route.params;
    const input = salesActionSchema.parse(await readJson(request));
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        let value;
        if (input.action === "submit")
          value = await submitQuotation(client, context, id, input.assignedTo);
        else if (input.action === "send")
          value = await sendQuotation(client, context, id, input.expiresInDays);
        else if (input.action === "convert")
          value = await convertQuotationToOrder(client, context, id);
        else if (input.action === "record_decision")
          value = await recordPublicQuoteDecision(
            client,
            context,
            "internal",
            input,
          );
        else throw new HttpError(400, "Unsupported quotation action.");

        if (["submit", "send", "convert"].includes(input.action))
          await captureQuotationGovernanceSnapshot(
            client,
            context,
            id,
            input.action,
          );

        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `sales.quotation.${input.action}`,
          entityType: "sales_quotation",
          entityId: id,
          afterData: value,
          request,
          client,
        });
        return value;
      },
    );
    return ok({ result });
  } catch (error) {
    try {
      rethrowSalesError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
