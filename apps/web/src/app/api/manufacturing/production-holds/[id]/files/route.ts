import { listHoldFiles, prepareHoldFileUpload, uploadHoldFile } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { manufacturingContext } from "@/features/manufacturing/shared/manufacturing-context";
import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";

// Evidence on a production hold: incident reports, photos, supplier confirmations, clearance records. Multipart: file.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ files: await listHoldFiles(client, context, id) }));
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "manufacturing", permission: "manufacturing.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareHoldFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await uploadHoldFile(client, manufacturingContext(session), id, { prepared }) }) as Record<string, unknown>, 201);
  });
}
