import { getMyAttachmentContent, getSupportAttachmentContent } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { requireSupportAccess, supportContext } from "@/features/support/shared/support-context";

// Governed download: the ticket must be visible to the caller, a private
// attachment only to sensitive viewers or its uploader (portal customers:
// their own tickets, never private attachments). Always a download.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const selfService = new URL(request.url).searchParams.get("selfService") === "1";
    const file = await tenantTransaction(session.organizationId, async (client) => {
      await requireSupportAccess(client, session, selfService ? "" : "support.view");
      const domain = supportContext(session);
      return selfService ? getMyAttachmentContent(client, domain, id) : getSupportAttachmentContent(client, domain, id);
    });
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
  } catch (error) {
    return errorResponse(error);
  }
}
