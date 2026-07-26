import { listBusinessDataRecords, listCrmRecords } from "@vercentlabs/api";

import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import {
  businessDataContext,
  businessDataDefinitions,
  isBusinessDataDefinition,
} from "@/lib/business-data";
import { crmContext, isCrmDefinition } from "@/lib/crm";
import { requireCrmResourceView } from "@/lib/crm-api";
import { csvCell } from "@/lib/csv";
import { tenantTransaction } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
import { audit } from "@/lib/security";

export async function GET(
  request: Request,
  route: { params: Promise<{ area: string; resource: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    if (!session.organizationId) throw new HttpError(401, "Workspace required.");
    const { area, resource } = await route.params;
    let rows: Array<Record<string, unknown>>;
    let columns: string[];
    let filename: string;

    if (area === "crm") {
      requirePermissionFromSession(session, PERMISSIONS.crmExport);
      if (!isCrmDefinition(resource)) throw new HttpError(404, "Unknown CRM resource.");
      requireCrmResourceView(session, resource);
      const context = crmContext(session);
      const result = await tenantTransaction(context.organizationId, (client) =>
        listCrmRecords(client, context, resource, { limit: 500, offset: 0, status: "all" }),
      );
      rows = result.rows;
      columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
      filename = `crm-${resource}-${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (area === "business-data") {
      requirePermissionFromSession(session, PERMISSIONS.businessDataView);
      if (!isBusinessDataDefinition(resource)) throw new HttpError(404, "Unknown business-data resource.");
      const context = businessDataContext(session);
      const result = await tenantTransaction(context.organizationId, (client) =>
        listBusinessDataRecords(client, context, resource, { limit: 5000, offset: 0, status: "all" }),
      );
      rows = result.rows;
      columns = businessDataDefinitions[resource].columns.map((column) => column.key);
      filename = `vercentlabs-${resource}-${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      throw new HttpError(404, "Unknown export area.");
    }

    const csv = `\uFEFF${[
      columns.map(csvCell).join(","),
      ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
    ].join("\r\n")}\r\n`;
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: `${area.replace("-", "_")}.${resource}.exported`,
      entityType: resource,
      afterData: { rowCount: rows.length, client: "mobile" },
      request,
    });
    return mobileOk(request, { csv, filename, rowCount: rows.length });
  } catch (error) {
    return mobileError(request, error);
  }
}
