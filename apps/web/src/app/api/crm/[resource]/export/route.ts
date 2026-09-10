import { listCrmRecords } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, isCrmDefinition, rethrowCrmError } from "@/modules/crm";
import { requireCrmResourceView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { csvCell } from "@/core/csv";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError } from "@/core/http";
import { audit } from "@/core/security";

const EXPORT_BATCH_SIZE = 500;

export async function GET(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmExport);
    const { resource } = await route.params;
    if (resource !== "leads") throw new HttpError(404, "CRM import/export is available for leads only.");
    if (!isCrmDefinition(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    requireCrmResourceView(session, resource);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const rows: Array<Record<string, unknown>> = [];
        let total = 0;
        do {
          const batch = await listCrmRecords(client, context, resource, {
            limit: EXPORT_BATCH_SIZE,
            offset: rows.length,
          });
          rows.push(...batch.rows);
          total = batch.total;
          if (!batch.rows.length) break;
        } while (rows.length < total);
        return { rows, total };
      },
    );
    const keys = Array.from(
      new Set(result.rows.flatMap((row) => Object.keys(row))),
    );
    const csv = `\uFEFF${[
      keys.map(csvCell).join(","),
      ...result.rows.map((row) =>
        keys.map((key) => csvCell(row[key])).join(","),
      ),
    ].join("\r\n")}\r\n`;

    await audit({
      organizationId: context.organizationId,
      actorUserId: session.userId,
      eventType: `crm.${resource}.exported`,
      entityType: resource,
      afterData: { rowCount: result.rows.length },
      request,
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="crm-${resource}-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
