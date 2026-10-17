import {
  bulkCustodyHandovers, bulkCustodyReturns, getAssetStores, getClearanceList, getCustodyClearance, getCustodyExceptions, getCustodyReport, getCustodyWorkspace, getDepartmentCustodians, getMyCustody,
  recordCannotReturn, resolveCustodyException, sendCustodyReminders, setDepartmentCustodian,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET workspace (?view=&userId=&departmentId=&storeLocationId=&search=) · mine · clearance (?userId=) · clearance-list · exceptions · departments · stores · report (?kind=)
// POST bulk-issue { rows, condition?, handOverNow?, idempotencyKey? } · bulk-return { assets, toType, storeLocationId?, departmentId?, condition, identityVerified, idempotencyKey? }
//      · resolve-exception { exceptionId, resolution, note } · department-custodian { departmentId, accountableUserId } · cannot-return { assetId, note } · reminders
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "workspace": return getCustodyWorkspace(client, context, Object.fromEntries(url.searchParams.entries()));
      case "mine": return getMyCustody(client, context);
      case "clearance": return getCustodyClearance(client, context, get("userId") ?? "");
      case "clearance-list": return getClearanceList(client, context);
      case "exceptions": return { rows: await getCustodyExceptions(client, context) };
      case "departments": return { rows: await getDepartmentCustodians(client, context) };
      case "stores": return { rows: await getAssetStores(client, context) };
      case "report": return { rows: await getCustodyReport(client, context, get("kind") ?? "custody-by-custodian") };
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "bulk-issue": return bulkCustodyHandovers(client, context, input);
      case "bulk-return": return bulkCustodyReturns(client, context, input);
      case "resolve-exception": return resolveCustodyException(client, context, String(input.exceptionId ?? ""), input);
      case "department-custodian": return setDepartmentCustodian(client, context, String(input.departmentId ?? ""), input);
      case "cannot-return": return recordCannotReturn(client, context, String(input.assetId ?? ""), input);
      case "reminders": return sendCustodyReminders(client, context);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
