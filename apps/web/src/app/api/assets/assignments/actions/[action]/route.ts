import { bulkAssignAssets, getAssignableAssets, getAssignmentExceptions, getAssignmentHistory, getAssignmentReport, getMyAssignmentRequests, sendAssignmentReminders } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET assignable (?search=&categoryId=) · mine · exceptions · history (?assetId=) · report (?kind=) · POST bulk { rows, purpose, …, idempotencyKey } · reminders
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "assignable": return getAssignableAssets(client, context, { search: get("search"), categoryId: get("categoryId") });
      case "mine": return getMyAssignmentRequests(client, context);
      case "exceptions": return { rows: await getAssignmentExceptions(client, context) };
      case "history": return { rows: await getAssignmentHistory(client, context, { assetId: get("assetId") }) };
      case "report": return { rows: await getAssignmentReport(client, context, get("kind") ?? "assets-by-employee") };
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "bulk": return bulkAssignAssets(client, context, input);
      case "reminders": return sendAssignmentReminders(client, context);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
