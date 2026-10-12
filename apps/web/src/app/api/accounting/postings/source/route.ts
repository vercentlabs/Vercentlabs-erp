import { getSourceAccounting } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingRead } from "@/features/accounting/shared/route-helpers";

// "Accounting recorded automatically" on a document: its postings, and their lines for people who may see Accounting.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const id = url.searchParams.get("id") ?? "";
  return accountingRead(request, async (client, context) => {
    if (!id) throw new HttpError(400, "A document is required.", "VALIDATION_FAILED");
    return { accounting: await getSourceAccounting(client, context, type, id) };
  }, "workspace.view");
}
