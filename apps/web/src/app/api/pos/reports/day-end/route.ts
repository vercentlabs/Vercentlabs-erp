import { z } from "zod";

import { generatePosDayEndReport, listPosDayEndReports } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const generateSchema = z.object({
  storeId: z.string().uuid(),
  scopeType: z.enum(["shift", "business_day"]),
  shiftId: z.string().uuid().optional(),
  terminalId: z.string().uuid().optional(),
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.report.view" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const rows = await listPosDayEndReports(client, posContext(session), {
      storeId: url.searchParams.get("storeId") || undefined,
      terminalId: url.searchParams.get("terminalId") || undefined,
      status: url.searchParams.get("status") || undefined,
      scopeType: url.searchParams.get("scopeType") || undefined,
      businessDateFrom: url.searchParams.get("businessDateFrom") || undefined,
      businessDateTo: url.searchParams.get("businessDateTo") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    });
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.report.generate" }, async ({ client, session }) => {
    const input = generateSchema.parse(await readJson(request));
    const result = await generatePosDayEndReport(client, posContext(session), input);
    return ok({ report: result }, 201);
  });
}
