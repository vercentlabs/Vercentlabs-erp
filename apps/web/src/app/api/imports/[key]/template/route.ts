import { buildImportTemplate, listImporters } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The downloadable template: every column of the import and one sample row.
export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  return workspaceRoute(request, { snapshot: true, action: "imports.template" }, async ({ session, snapshot }) => {
    const { key } = await context.params;
    if (!listImporters(session, snapshot?.accessibleModules ?? []).some((importer) => importer.key === key)) throw new HttpError(404, "There is no such import.");
    return new Response(buildImportTemplate(key), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${key.replace(/[^a-z0-9]+/gi, "-")}-template.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  });
}
