import {
  captureProcurementGovernanceSnapshot,
  transitionProcurementRecord,
  transitionProcurementReceiptWithStockMovement,
} from "@vercentlabs/api";
import { procurementSession, tenantTransaction } from "@/modules/procurement/server";
import { stockContext } from "@/modules/stock";
import { assertSameOriginOrMobile } from "@/core/security";
import { errorResponse, ok, readJson } from "@/core/http";
import { procurementActionSchema } from "@/modules/procurement/validation";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const { session, context } = await procurementSession(true);
    const { resource, id } = await params;
    const input = procurementActionSchema.parse(await readJson(request));
    const record = await tenantTransaction(
      context.organizationId,
      async (c) => {
        const updated =
          resource === "receipts" && ["approve", "reverse"].includes(input.action)
            ? await transitionProcurementReceiptWithStockMovement(
                c,
                context,
                stockContext(session),
                id,
                input.action,
                input,
              )
            : await transitionProcurementRecord(
                c,
                context,
                resource,
                id,
                input.action,
                input,
              );
        if (
          [
            "suppliers",
            "requisitions",
            "sourcing-events",
            "agreements",
            "purchase-orders",
            "receipts",
          ].includes(resource)
        ) {
          await captureProcurementGovernanceSnapshot(
            c,
            context,
            resource,
            id,
            `lifecycle:${input.action}`,
          );
        }
        return updated;
      },
    );
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
