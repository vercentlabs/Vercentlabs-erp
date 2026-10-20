import { listAccountingExpenseFiles, prepareAccountingExpenseFileUpload, uploadAccountingExpenseFile } from "@vercentlabs/api";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { accountingContext } from "@/features/accounting/shared/accounting-context";
import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ expenseId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { expenseId } = await params;
  return accountingRead(request, async (client, context) => ({ files: await listAccountingExpenseFiles(client, context, expenseId) }));
}

// Multipart: file (a photo of the receipt, the bill's PDF). The type is checked from the bytes; the module checks who may add it.
export async function POST(request: Request, { params }: Params) {
  const { expenseId } = await params;
  return workspaceRoute(request, { module: "accounting", permission: "accounting.view", billingWrite: true }, async ({ client, session }) => {
    const form = await request.formData().catch(() => { throw new HttpError(400, "Choose a file to upload."); });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
    if (file.size > 10 * 1024 * 1024) throw new HttpError(413, "The file is larger than 10 MB.");
    const prepared = await prepareAccountingExpenseFileUpload({ fileName: file.name.slice(0, 240), bytes: Buffer.from(await file.arrayBuffer()) }, process.env);
    return ok({ file: await uploadAccountingExpenseFile(client, accountingContext(session), expenseId, { prepared }) }, 201);
  });
}
