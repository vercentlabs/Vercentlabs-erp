import { HISTORY_IMPORT_COLUMNS, MIGRATION_SOURCES, analyzeHistoryImport, buildHistoryImportTemplate, importRecordHistory } from "@vercentlabs/api/crm";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Past notes and activities (CRM plan 5.7). GET: the columns and the guide for moving in from other tools; ?template=1 the CSV template.
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("template") === "1")
    return new Response(buildHistoryImportTemplate(), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="past-activities-template.csv"' } });
  return workspaceRoute(request, { module: "crm" }, async () => ok({ columns: HISTORY_IMPORT_COLUMNS, sources: MIGRATION_SOURCES }));
}

// Multipart: file, step ("analyze" | "import"), mapping (JSON, optional).
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Choose a file.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a file.");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (form.get("step") !== "import") return ok({ analysis: analyzeHistoryImport({ bytes, fileName: file.name }) });
    const mappingText = form.get("mapping");
    const mapping = typeof mappingText === "string" && mappingText ? JSON.parse(mappingText) as Record<string, string> : undefined;
    return ok({ result: await importRecordHistory(client, crmContext(session, snapshot), { bytes, fileName: file.name, mapping }) });
  });
}
