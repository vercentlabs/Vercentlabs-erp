import { readReportRunOutput } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";

// The requester (or a reports administrator) only; 410 once the file expired.
// The CSV was formula-neutralised when generated.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(request, { action: "reports.runs.download" }, async ({ client, session }) => {
    const file = await readReportRunOutput(client, session, id);
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
