import { listCrmRecords } from "@vercent/api";

import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext, isCrmDefinition, rethrowCrmError } from "@/lib/crm";
import { requireCrmResourceView } from "@/lib/crm-api";
import { csvCell } from "@/lib/csv";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/http";
import { audit } from "@/lib/security";

export async function GET(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmExport);
    const { resource } = await route.params;
    if (!isCrmDefinition(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    requireCrmResourceView(session, resource);
    const context = crmContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      listCrmRecords(client, context, resource, { limit: 500, offset: 0 }),
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
