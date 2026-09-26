import { getCrmAttachmentContent } from "@vercentlabs/api";

import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Governed download — CRM parent-record access first, then the Shared
// Platform file gate (only a scan-clean, non-archived version; quarantined,
// rejected or pending answers 404 exactly like a missing file). Bytes come
// from object storage (or, for files uploaded before migration 063, the
// legacy database column) and are streamed only through this route. Never proxies through anything that could serve the bytes
// with a browser-executable Content-Type for an untrusted file — always
// forces a download disposition.
export async function GET(request: Request, context: { params: Promise<{ entityType: string; entityId: string; id: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { entityType, entityId, id } = await context.params;
    const attachment = await getCrmAttachmentContent(client, crmContext(session), entityType as never, entityId, id);
    const fileName = attachment.fileName.replace(/["\r\n]/g, "");
    return new Response(new Uint8Array(attachment.body), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(attachment.body.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
