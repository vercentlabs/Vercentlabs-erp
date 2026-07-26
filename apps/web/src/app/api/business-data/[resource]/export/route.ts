import { listBusinessDataRecords } from "@vercentlabs/api";

import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import {
  businessDataContext,
  businessDataDefinitions,
  isBusinessDataDefinition,
  rethrowBusinessDataError,
} from "@/lib/business-data";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/http";
import { audit } from "@/lib/security";

import { csvCell } from "@/lib/csv";

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }

    const { resource } = await routeContext.params;
    if (!isBusinessDataDefinition(resource)) {
      throw new HttpError(404, "Unknown business-data resource.");
    }

    requirePermissionFromSession(session, PERMISSIONS.businessDataView);

    const context = businessDataContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      listBusinessDataRecords(client, context, resource, {
        status: "all",
        limit: 5000,
        offset: 0,
      }),
    );

    const columns = businessDataDefinitions[resource].columns.map(
      (column) => column.key,
    );
    const rows = [
      columns.map(csvCell).join(","),
      ...result.rows.map((row) =>
        columns.map((column) => csvCell(row[column])).join(","),
      ),
    ];
    const csv = `\uFEFF${rows.join("\r\n")}\r\n`;

    await audit({
      organizationId: context.organizationId,
      actorUserId: session.userId,
      eventType: `business_data.${resource}.exported`,
      entityType: resource,
      afterData: { rowCount: result.rows.length },
      request,
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vercentlabs-${resource}-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    try {
      rethrowBusinessDataError(error);
    } catch (mappedError) {
      return errorResponse(mappedError);
    }
  }
}
