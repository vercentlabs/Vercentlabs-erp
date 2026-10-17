import { listAssetFiles, uploadAssetFile, prepareProjectFileUpload } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";
import { assetsRead } from "@/features/assets/shared/route-helpers";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";

// An asset's photos, manuals, purchase invoices and warranty certificates. Multipart: file, kind?.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, async (client, context) => ({ files: await listAssetFiles(client, context, id) }));
}
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "assets", permission: "assets.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareProjectFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await uploadAssetFile(client, assetsContext(session), id, { prepared }) }) as Record<string, unknown>, 201);
  });
}
