import { previewSalesDocument } from "@vercentlabs/api";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
import { rethrowSalesError } from "@/lib/sales";
import { salesDocumentSchema } from "@/lib/sales-validation";
import { salesSession, tenantTransaction } from "@/lib/sales-route";
export async function POST(request: Request) { try { assertSameOrigin(request); const { context } = await salesSession(); const input = salesDocumentSchema.parse(await readJson(request)); const preview = await tenantTransaction(context.organizationId, (client) => previewSalesDocument(client, context, input)); return ok({ preview }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
