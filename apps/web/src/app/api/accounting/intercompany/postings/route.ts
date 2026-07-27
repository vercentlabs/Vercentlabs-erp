import { createIntercompanyJournal } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { intercompanyJournalSchema } from "@/lib/accounting-validation";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = intercompanyJournalSchema.parse(await readJson(request)); return ok({ posting: await tenantTransaction(context.organizationId, (client) => createIntercompanyJournal(client, context, input)) }, 201); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
