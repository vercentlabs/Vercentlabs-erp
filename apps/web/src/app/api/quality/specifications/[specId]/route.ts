import { compareSpecificationVersions, getInspectionSpecification, getSpecificationUsage, getSpecificationVersionHistory, previewInspectionSpecification } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// One inspection specification (?versionId=), or one part of it: ?part=history · usage · preview (&versionId) · compare (&from&to).
type Params = { params: Promise<{ specId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { specId } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return qualityRead(request, async (client, context) => {
    switch (get("part")) {
      case "history": return getSpecificationVersionHistory(client, context, specId);
      case "usage": return getSpecificationUsage(client, context, specId);
      case "preview": return previewInspectionSpecification(client, context, specId, get("versionId") ?? "");
      case "compare": return compareSpecificationVersions(client, context, specId, get("from") ?? "", get("to") ?? "");
      default: return getInspectionSpecification(client, context, specId, { versionId: get("versionId") ?? null });
    }
  });
}
