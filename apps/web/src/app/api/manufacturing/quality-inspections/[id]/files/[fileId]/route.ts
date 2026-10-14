import { readInspectionFile, removeInspectionFile } from "@vercentlabs/api";
import { z } from "zod";

import { workspaceRoute } from "@/core/workspace-route";
import { manufacturingContext } from "@/features/manufacturing/shared/manufacturing-context";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// One evidence file: download it, or remove it (only while the inspection is open).
type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "manufacturing", permission: "manufacturing.view" }, async ({ client, session }) => {
    const file = await readInspectionFile(client, manufacturingContext(session), id, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

export async function DELETE(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return manufacturingMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ result: await removeInspectionFile(client, context, id, fileId) }));
}
