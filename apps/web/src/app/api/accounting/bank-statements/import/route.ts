import { importBankStatementFile } from "@vercentlabs/api";

import { statementRoute } from "@/features/accounting/shared/statement-upload";

// Imports a checked statement: a file with a bad row is refused, duplicates are left out, and the balances must add up.
export async function POST(request: Request) {
  return statementRoute(request, async (client, context, input) => ({ statement: await importBankStatementFile(client, context, input) }), 201);
}
