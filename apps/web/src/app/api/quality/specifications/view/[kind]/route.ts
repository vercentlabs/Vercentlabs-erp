import {
  exportInspectionSpecifications, getSpecificationOverview, getSpecificationReport, getSpecificationSettings, listSpecificationConflicts, listSpecificationExceptions,
  listSpecificationOptions, resolveApplicableInspectionSpecification,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { qualityContext } from "@/features/quality/shared/quality-context";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// Quality — Inspection Specifications reads: options · overview · conflicts · exceptions · report · settings · resolve · export (CSV).
// Every domain function checks its own permission.
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  if (kind === "export") {
    return workspaceRoute(request, { module: "quality", permission: "quality.view" }, async ({ client, session }) => {
      const file = await exportInspectionSpecifications(client, qualityContext(session), { kind: get("kind") ?? "register" });
      return new Response(file.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
    });
  }
  return qualityRead(request, async (client, context) => {
    switch (kind) {
      case "options": return { options: await listSpecificationOptions(client, context) };
      case "overview": return getSpecificationOverview(client, context);
      case "conflicts": return listSpecificationConflicts(client, context);
      case "exceptions": return listSpecificationExceptions(client, context, { status: get("status") });
      case "report": return getSpecificationReport(client, context, get("kind") ?? "register");
      case "settings": return getSpecificationSettings(client, context);
      case "resolve":
        return resolveApplicableInspectionSpecification(client, context, { stage: get("stage"), itemId: get("itemId"), supplierId: get("supplierId"), warehouseId: get("warehouseId"),
          date: get("date"), quantity: get("quantity") });
      default: throw new HttpError(404, "Unknown specification view.");
    }
  });
}
