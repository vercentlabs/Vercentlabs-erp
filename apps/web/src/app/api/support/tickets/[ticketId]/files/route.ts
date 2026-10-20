import { addSupportAttachment, prepareSupportAttachmentUpload } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";
import { supportContext } from "@/features/support/shared/support-context";

// A file on a ticket (multipart: file, and optionally messageId and private).
type Params = { params: Promise<{ ticketId: string }> };
export async function POST(request: Request, ctx: Params) {
  const { ticketId } = await ctx.params;
  return workspaceRoute(request, { module: "support", permission: "support.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareSupportAttachmentUpload({ fileName: upload.fileName, mimeType: "", bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await addSupportAttachment(client, supportContext(session), ticketId, { prepared, messageId: upload.field("messageId") || undefined, private: upload.field("private") === "true" }) }) as Record<string, unknown>, 201);
  });
}
