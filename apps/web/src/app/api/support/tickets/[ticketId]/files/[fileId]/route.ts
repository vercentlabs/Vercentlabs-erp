import { readSupportAttachment, removeSupportAttachment } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { supportContext } from "@/features/support/shared/support-context";

// One file: download (a private one only for staff), or remove one an agent added (never one that came with an email).
type Params = { params: Promise<{ ticketId: string; fileId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { ticketId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "support", permission: "support.view" }, async ({ client, session }) => {
    const file = await readSupportAttachment(client, supportContext(session), ticketId, fileId);
    return new Response(new Uint8Array(file.body), { headers: { "Content-Type": file.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`, "Cache-Control": "private, no-store" } });
  });
}
export async function DELETE(request: Request, ctx: Params) {
  const { ticketId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "support", permission: "support.view", billingWrite: true }, async ({ client, session }) =>
    ok(toWire(await removeSupportAttachment(client, supportContext(session), ticketId, fileId)) as Record<string, unknown>));
}
