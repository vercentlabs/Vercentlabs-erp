import { previewSalesDocument } from "@vercentlabs/api";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
import { rethrowSalesError } from "@/modules/sales";
import { salesDocumentSchema } from "@/modules/sales/validation";
import { salesSession, tenantTransaction } from "@/modules/sales/server";
export async function POST(request: Request) { try { assertSameOrigin(request); const { context } = await salesSession(); const input = salesDocumentSchema.parse(await readJson(request)); const preview = await tenantTransaction(context.organizationId, (client) => previewSalesDocument(client, context, input)); return ok({ preview }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
