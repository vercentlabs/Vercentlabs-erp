import {
  exportQualityControlPoints, getQualityControlOverview, getQualityControlPointReport, listInspectionObligations, listQualityControlPointConflicts, listQualityControlPointOptions,
  previewQualityControlPoints,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { qualityContext } from "@/features/quality/shared/quality-context";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// Quality Control Points reads: options · overview · conflicts · requirements · preview · report · export (CSV). Each checks its own permission.
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  if (kind === "export") {
    return workspaceRoute(request, { module: "quality", permission: "quality.view" }, async ({ client, session }) => {
      const file = await exportQualityControlPoints(client, qualityContext(session), { kind: get("kind") ?? "register" });
      return new Response(file.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
    });
  }
  return qualityRead(request, async (client, context) => {
    switch (kind) {
      case "options": return { options: await listQualityControlPointOptions(client, context) };
      case "overview": return getQualityControlOverview(client, context);
      case "conflicts": return listQualityControlPointConflicts(client, context);
      case "requirements": return listInspectionObligations(client, context, { view: get("view"), status: get("status"), controlPointId: get("controlPointId") });
      case "preview": return previewQualityControlPoints(client, context, { trigger: get("trigger"), itemId: get("itemId"), supplierId: get("supplierId"), warehouseId: get("warehouseId"), date: get("date") });
      case "report": return getQualityControlPointReport(client, context, get("kind") ?? "register");
      default: throw new HttpError(404, "Unknown control point view.");
    }
  });
}
