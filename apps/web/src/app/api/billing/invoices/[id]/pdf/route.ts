import { renderTaxDocumentPdf } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// Vercentlabs' tax invoice or credit note for one of the company's subscription charges, as a PDF.
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return workspaceRoute(request, { permission: BILLING_PERMISSIONS.view, action: "billing.invoice.pdf" }, async ({ client, session }) => {
    const { fileName, body } = await renderTaxDocumentPdf(client, session.organizationId, id);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
