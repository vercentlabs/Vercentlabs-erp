import {
  amendSalesOrder,
  cancelSalesOrder,
  completeFulfillmentRequest,
  confirmSalesOrder,
  createFulfillmentRequest,
  createInvoiceRequest,
  placeOrderHold,
  releaseOrderHold,
  submitSalesOrder,
} from "@vercentlabs/api";

import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { rethrowSalesError } from "@/lib/sales";
import { salesActionSchema } from "@/lib/sales-validation";
import { salesSession, tenantTransaction } from "@/lib/sales-route";

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { session, context } = await salesSession(true);
    const { id } = await route.params;
    const input = salesActionSchema.parse(await readJson(request));
    const result = await tenantTransaction(context.organizationId, async (client) => {
      let value;
      if (input.action === "submit") value = await submitSalesOrder(client, context, id, input.assignedTo);
      else if (input.action === "confirm") value = await confirmSalesOrder(client, context, id, input);
      else if (input.action === "hold") value = await placeOrderHold(client, context, id, input);
      else if (input.action === "release_hold") value = await releaseOrderHold(client, context, id, input);
      else if (input.action === "cancel") value = await cancelSalesOrder(client, context, id, input.reason || "");
      else if (input.action === "request_fulfillment") value = await createFulfillmentRequest(client, context, id, input.idempotencyKey || "");
      else if (input.action === "complete_fulfillment") {
        if (!input.requestId) throw new HttpError(400, "Fulfilment request is required.");
        value = await completeFulfillmentRequest(client, context, input.requestId, {
          lines: input.fulfillmentLines,
          externalReference: input.externalReference,
        });
      } else if (input.action === "request_invoice") value = await createInvoiceRequest(client, context, id, input);
      else if (input.action === "amend") {
        if (!input.document) throw new HttpError(400, "The amended order document is required.");
        value = await amendSalesOrder(client, context, id, {
          ...input.document,
          amendmentReason: input.reason,
        });
      } else throw new HttpError(400, "Unsupported order action.");
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: `sales.order.${input.action}`,
        entityType: "sales_order",
        entityId: id,
        afterData: value,
        request,
        client,
      });
      return value;
    });
    return ok({ result });
  } catch (error) {
    try {
      rethrowSalesError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
