import { createIntercompanyJournal } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { intercompanyJournalSchema } from "@/modules/accounting/validation";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function POST(request: Request) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = intercompanyJournalSchema.parse(await readJson(request)); return ok({ posting: await tenantTransaction(context.organizationId, (client) => createIntercompanyJournal(client, context, input)) }, 201); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
