import { z } from "zod";

import { requireApiPermission } from "@/core/authorization";
import { requireBillingWriteAccess } from "@/core/billing";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import {
  createReportDefinition,
  createReportRun,
  listPlatformReportDatasets,
  listReportDefinitions,
  listReportRuns,
} from "@/core/shared-platform";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("definition"), name: z.string().trim().min(1).max(160), datasetKey: z.string().trim().min(1).max(160), columns: z.array(z.record(z.string(), z.unknown())).max(100), filters: z.record(z.string(), z.unknown()).optional(), schedule: z.record(z.string(), z.unknown()).optional().nullable() }),
  z.object({ action: z.literal("run"), reportDefinitionId: z.string().uuid().optional(), datasetKey: z.string().trim().max(160).optional(), filters: z.record(z.string(), z.unknown()).optional() }).refine((value) => Boolean(value.reportDefinitionId || value.datasetKey), { message: "A report definition or dataset is required." }),
]);

export async function GET() {
  try {
    const session = await requireApiPermission("platform.reports.manage");
    const [definitions, runs] = await Promise.all([
      listReportDefinitions(session.organizationId),
      listReportRuns(session.organizationId),
    ]);
    return ok({ definitions, runs, datasets: listPlatformReportDatasets(session) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("platform.reports.manage");
    await requireBillingWriteAccess(session.organizationId);
    const input = actionSchema.parse(await readJson(request));
    const result = input.action === "definition"
      ? await createReportDefinition(session, input)
      : await createReportRun(session, input);
    await audit({ organizationId: session.organizationId, actorUserId: session.userId, eventType: `platform.report.${input.action}.created`, entityType: input.action === "definition" ? "report_definition" : "report_run", entityId: result.id, request });
    return ok({ ...result, message: input.action === "definition" ? "Report definition created." : "Report launch recorded." }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
