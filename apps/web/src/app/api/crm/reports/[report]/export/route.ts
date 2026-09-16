import { getCrmReport, rowsToCsv } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

const FILTER_KEYS = ["from", "to"] as const;

// F030 Stage A2 §12. Governed export — reuses the exact same
// getCrmReport call the interactive report uses (identical row/field
// scope by construction, never a parallel query), and rowsToCsv/csvCell
// (@vercentlabs/reporting-engine) for the same formula-injection
// neutralization already wired into F021's Lead export. Columns are
// derived from whatever keys the first row actually has, mirroring
// CrmReportsScreen.tsx's own column-derivation logic exactly, so the
// exported CSV always matches what the screen renders.
export async function GET(request: Request, context: { params: Promise<{ report: string }> }) {
  try {
    const session = await requireWorkspace();
    const { report } = await context.params;
    const url = new URL(request.url);
    const filters: Record<string, string> = {};
    for (const key of FILTER_KEYS) {
      const value = url.searchParams.get(key);
      if (value) filters[key] = value;
    }
    const result = await withClient(async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.reportsView);
      return getCrmReport(client, crmContext(session), report, filters);
    });
    const rows = result.rows as Array<Record<string, unknown>>;
    if (!rows.length) return ok({ message: "No rows to export for this report and date range." }, 200);
    const columns = Object.keys(rows[0]).map((key) => ({ key, label: key }));
    const csv = rowsToCsv(columns, rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${report}-report.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
