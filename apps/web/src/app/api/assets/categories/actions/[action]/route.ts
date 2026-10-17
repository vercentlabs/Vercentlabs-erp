import {
  addStarterCategories, decideAssetReclassification, getAssetCategoryReport, getAssetReclassifications, getCategoryTemplates, getSelectableCategories,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET templates · selectable · report (?kind=) · reclassifications (?status=&assetId=)
// POST starter-templates { templates: [key…] } · decide-reclassification { reclassificationId, decision: APPROVE|REJECT, note?, financeAdjustmentReference? }
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "templates": return { rows: await getCategoryTemplates(client, context) };
      case "selectable": return { rows: await getSelectableCategories(client, context) };
      case "report": return { rows: await getAssetCategoryReport(client, context, get("kind") ?? "by-category") };
      case "reclassifications": return getAssetReclassifications(client, context, { status: get("status"), assetId: get("assetId") });
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "starter-templates": return addStarterCategories(client, context, input);
      case "decide-reclassification": return decideAssetReclassification(client, context, String(input.reclassificationId ?? ""), input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
