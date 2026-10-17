import { listExpenseFiles, prepareProjectFileUpload, uploadExpenseReceipt } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { projectsRead } from "@/features/projects/shared/route-helpers";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";

// An expense's receipts and invoices. Multipart: file.
type Params = { params: Promise<{ expenseId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { expenseId } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ files: await listExpenseFiles(client, context, expenseId) }));
}
export async function POST(request: Request, ctx: Params) {
  const { expenseId } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareProjectFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await uploadExpenseReceipt(client, projectsContext(session), expenseId, { prepared }) }) as Record<string, unknown>, 201);
  });
}
