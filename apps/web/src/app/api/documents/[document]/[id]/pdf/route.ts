import { getDocumentRenderer, renderAuthorizedDocument } from "@vercentlabs/api";

import { errorResponse, HttpError } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Printable PDF of a registered document (POS receipt, Sales quotation, Sales
// order). Module access + the renderer's permission are checked here; the
// module's own read then applies its permission, company/store scope and field
// redaction. No template, HTML or file path is ever taken from the request.
export async function GET(request: Request, context: { params: Promise<{ document: string; id: string }> }) {
  const { document, id } = await context.params;
  const renderer = getDocumentRenderer(document);
  if (!renderer) return errorResponse(new HttpError(404, "Unknown document."));
  return workspaceRoute(
    request,
    { module: renderer.moduleKey, permission: renderer.permission, action: `documents.${renderer.key}.pdf`, transaction: "tenant" },
    async ({ client, session }) => {
      const pdf = await renderAuthorizedDocument(client, session, renderer.key, id);
      return new Response(new Uint8Array(pdf.body), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdf.fileName}"`,
          "Content-Length": String(pdf.body.length),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );
}
