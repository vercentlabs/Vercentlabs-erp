import { getCrmAttachmentContent } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Governed download — getCrmAttachmentContent only ever returns bytes for
// a scan-clean attachment (its own WHERE clause requires
// lifecycle_status='clean' AND scan_status IN ('clean','not_applicable'));
// a quarantined/rejected/pending file 404s exactly like a missing one, no
// separate signal that would let a caller distinguish quarantine from
// absence. Never proxies through anything that could serve the bytes
// with a browser-executable Content-Type for an untrusted file — always
// forces a download disposition.
export async function GET(_request: Request, context: { params: Promise<{ entityType: string; entityId: string; id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { entityType, entityId, id } = await context.params;
    const attachment = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return getCrmAttachmentContent(client, crmContext(session), entityType as never, entityId, id);
    });
    const fileName = attachment.file_name.replace(/"/g, "");
    return new Response(new Uint8Array(attachment.content), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(attachment.content.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
