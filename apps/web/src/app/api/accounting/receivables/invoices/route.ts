import { createCustomerInvoice, listCustomerInvoices } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { invoiceSchema } from "@/lib/accounting-validation";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
export async function GET(request: Request) { try { const { context } = await accountingSession(); const filters = Object.fromEntries(new URL(request.url).searchParams.entries()); const invoices = await tenantTransaction(context.organizationId, (client) => listCustomerInvoices(client, context, filters)); return ok({ invoices }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
export async function POST(request: Request) { try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = invoiceSchema.parse(await readJson(request)); const invoice = await tenantTransaction(context.organizationId, (client) => createCustomerInvoice(client, context, input)); return ok({ invoice }, 201); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
