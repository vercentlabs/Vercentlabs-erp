import { readCrmDataJobOutput } from "@vercentlabs/api/crm";

import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The file a finished background run produced (the export, or an import's rows that were not imported), for the person who started it;
// 410 once it expired. The CSV was formula-neutralised when it was written.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const file = await readCrmDataJobOutput(client, crmContext(session, snapshot), id);
    return new Response(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.fileName.replace(/["\r\n]/g, "")}"`,
        "Content-Length": String(file.body.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
