import { listBankStatementsOverview } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// Imported statements, newest first, with how far each is reconciled.
export async function GET(request: Request) {
  const bankAccountId = new URL(request.url).searchParams.get("bankAccountId") ?? undefined;
  return accountingRead(request, async (client, context) => ({ statements: await listBankStatementsOverview(client, context, { bankAccountId }) }));
}
