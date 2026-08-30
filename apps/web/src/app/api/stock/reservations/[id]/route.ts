import { releaseStockReservation } from "@vercentlabs/api";
import { stockSession, tenantTransaction } from "@/modules/stock/server";
import { assertSameOrigin, audit } from "@/core/security";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertStockUuid } from "@/modules/stock/validation";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { session, context } = await stockSession(true);
    const { id } = await params;
    assertStockUuid(id, "Stock reservation");
    const rawInput = await readJson(request);
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput))
      throw new HttpError(400, "Reservation transition input must be a JSON object.");
    const input = rawInput as Record<string, unknown>;
    const status = String(input.status || "released");
    if (!["released", "cancelled", "consumed"].includes(status))
      throw new HttpError(400, "Reservation close status is invalid.");
    const reservation = await tenantTransaction(context.organizationId, async (client) => {
      const result = await releaseStockReservation(client, context, id, {
        status: status as "released" | "cancelled" | "consumed",
      });
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: `stock.reservation.${String(result.status || "closed")}`, entityType: "stock_reservation", entityId: id, metadata: { status: result.status, referenceType: result.reference_type, referenceId: result.reference_id }, request, client });
      return result;
    });
    return ok({ reservation });
  } catch (error) { return errorResponse(error); }
}
