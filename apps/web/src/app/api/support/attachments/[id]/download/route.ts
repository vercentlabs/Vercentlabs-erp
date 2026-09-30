import { getSupportAttachmentContent } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { supportContext } from "@/features/support/shared/support-context";

// Governed download: the ticket must be visible to the caller, a private
// attachment only to sensitive viewers or its uploader. Always a download.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const action = "support.attachment.download";
  const options = { module: "support", permission: "support.view", action };
  return workspaceRoute(request, options, async ({ client, session }) => {
    const { id } = await context.params;
    const domain = supportContext(session);
    const file = await getSupportAttachmentContent(client, domain, id);
    return new Response(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file.fileName.replace(/["\r\n]/g, "")}"`,
        "Content-Length": String(file.body.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
