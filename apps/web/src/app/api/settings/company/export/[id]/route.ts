import { readWorkspaceExport } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { action: "organization.export.download", auditDenial: true }, async ({ client, session }) => {
    const content = await readWorkspaceExport(client, session, id);
    return new Response(new Uint8Array(content.body), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${content.fileName ?? "workspace-export.zip"}"`, "Cache-Control": "private, no-store" },
    });
  });
}
