import { createSalesOrder, listSalesOrders } from "@vercent/api";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { rethrowSalesError } from "@/lib/sales";
import { salesDocumentSchema } from "@/lib/sales-validation";
import { salesSession, tenantTransaction } from "@/lib/sales-route";
export async function GET(request: Request) { try { const { context } = await salesSession(); const filters = Object.fromEntries(new URL(request.url).searchParams.entries()); const orders = await tenantTransaction(context.organizationId, (client) => listSalesOrders(client, context, filters)); return ok({ orders }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
export async function POST(request: Request) { try { assertSameOrigin(request); const { session, context } = await salesSession(true); const input = salesDocumentSchema.parse(await readJson(request)); const order = await tenantTransaction(context.organizationId, async (client) => { const created = await createSalesOrder(client, context, input); await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "sales.order.created", entityType: "sales_order", entityId: String(created.id), afterData: input, request, client }); return created; }); return ok({ order, message: "Sales order created." }, 201); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
