import { listRefundFiles, prepareRefundFileUpload, uploadRefundFile } from "@vercentlabs/api";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { accountingContext } from "@/features/accounting/shared/accounting-context";
import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

async function readUpload(request: Request) {
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Choose a file to upload.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
  if (file.size > 10 * 1024 * 1024) throw new HttpError(413, "The file is larger than 10 MB.");
  return { bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name.slice(0, 240) };
}

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return accountingRead(request, async (client, context) => ({ files: await listRefundFiles(client, context, id) }), "accounting.refund.view");
}

// Multipart: file. The module checks who may add it; the type is checked from the bytes.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "accounting", permission: "accounting.refund.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareRefundFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok({ file: await uploadRefundFile(client, accountingContext(session), id, { prepared }) }, 201);
  });
}
