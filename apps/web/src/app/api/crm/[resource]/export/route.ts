import { listCrmRecords } from "@vercent/api";
import { getSessionContext } from "@/lib/auth";
import { crmContext, isCrmDefinition, rethrowCrmError } from "@/lib/crm";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/http";
function cell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export async function GET(
  _request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmExport);
    const { resource } = await route.params;
    if (!isCrmDefinition(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    const context = crmContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      listCrmRecords(client, context, resource, { limit: 500, offset: 0 }),
    );
    const keys = Array.from(
      new Set(result.rows.flatMap((row) => Object.keys(row))),
    );
    const csv = [
      keys.map(cell).join(","),
      ...result.rows.map((row) => keys.map((key) => cell(row[key])).join(",")),
    ].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=crm-${resource}.csv`,
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
