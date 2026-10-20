import { z } from "zod";

import { readAccountingExpenseFile, removeAccountingExpenseFile } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { accountingContext } from "@/features/accounting/shared/accounting-context";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ expenseId: string; fileId: string }> };

// The file itself: shown inline when it is an image or a PDF (the approver looks at the receipt), downloaded otherwise.
export async function GET(request: Request, { params }: Params) {
  const { expenseId, fileId } = await params;
  return workspaceRoute(request, { module: "accounting", permission: "accounting.view" }, async ({ client, session }) => {
    const file = await readAccountingExpenseFile(client, accountingContext(session), expenseId, fileId);
    const viewable = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimeType ?? "");
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": viewable ? file.mimeType : "application/octet-stream",
        "Content-Disposition": `${viewable ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });
}

// Removed only before the expense is submitted (the module checks).
export async function DELETE(request: Request, { params }: Params) {
  const { expenseId, fileId } = await params;
  return accountingMutation(request, z.object({}), async (client, context) => ({ result: await removeAccountingExpenseFile(client, context, expenseId, fileId) }));
}
