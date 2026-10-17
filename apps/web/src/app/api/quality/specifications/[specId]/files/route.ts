import { listSpecificationFiles, prepareProjectFileUpload, uploadSpecificationFile } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";
import { qualityContext } from "@/features/quality/shared/quality-context";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// A specification's drawings, standards, test procedures and reference photos. Multipart: file.
type Params = { params: Promise<{ specId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { specId } = await ctx.params;
  return qualityRead(request, async (client, context) => ({ files: await listSpecificationFiles(client, context, specId) }));
}
export async function POST(request: Request, ctx: Params) {
  const { specId } = await ctx.params;
  return workspaceRoute(request, { module: "quality", permission: "quality.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareProjectFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await uploadSpecificationFile(client, qualityContext(session), specId, { prepared }) }) as Record<string, unknown>, 201);
  });
}
