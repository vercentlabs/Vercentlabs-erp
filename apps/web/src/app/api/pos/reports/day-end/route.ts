import { z } from "zod";

import { assertSameOriginOrMobile, generatePosDayEndReport, listPosDayEndReports } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

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
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.report.view");
      return listPosDayEndReports(client, posContext(session), {
        storeId: url.searchParams.get("storeId") || undefined,
        terminalId: url.searchParams.get("terminalId") || undefined,
        status: url.searchParams.get("status") || undefined,
        scopeType: url.searchParams.get("scopeType") || undefined,
        businessDateFrom: url.searchParams.get("businessDateFrom") || undefined,
        businessDateTo: url.searchParams.get("businessDateTo") || undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
      });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = generateSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.report.generate");
      return generatePosDayEndReport(client, posContext(session), input);
    });
    return ok({ report: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
