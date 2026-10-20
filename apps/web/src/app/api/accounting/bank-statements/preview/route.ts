import { previewBankStatement } from "@vercentlabs/api";

import { statementRoute } from "@/features/accounting/shared/statement-upload";

// Reads and checks a statement file (headings, column mapping, each row, duplicates) without saving anything.
export async function POST(request: Request) {
  return statementRoute(request, async (client, context, input) => ({ preview: await previewBankStatement(client, context, input) }));
}
