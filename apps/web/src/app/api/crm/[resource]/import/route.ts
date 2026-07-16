import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { createCrmRecord } from "@vercent/api";
import { getSessionContext } from "@/lib/auth";
import { crmContext, isCrmDefinition, rethrowCrmError } from "@/lib/crm";
import { crmSchemas } from "@/lib/crm-validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
function parseLine(line: string) {
  const values: string[] = [];
  let value = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') {
      value += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += ch;
  }
  values.push(value);
  return values;
}
export async function POST(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmImport);
    const { resource } = await route.params;
    if (!isCrmDefinition(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    const text = await request.text();
    if (text.length > 2_000_000)
      throw new HttpError(413, "CSV import is limited to 2 MB.");
    const lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(Boolean);
    if (lines.length < 2)
      throw new HttpError(
        400,
        "CSV must include a header and at least one record.",
      );
    if (lines.length > 1001)
      throw new HttpError(400, "Import a maximum of 1,000 records at a time.");

    await requireBillingWriteAccess(session.organizationId);

    await incrementBillingUsage(session.organizationId, "api_requests_monthly");

    await incrementBillingUsage(
      session.organizationId,
      "imports_rows_monthly",
      lines.length - 1,
    );
    const headers = parseLine(lines[0]);
    const context = crmContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        let succeeded = 0;
        const errors: Array<{ row: number; message: string }> = [];
        for (let index = 1; index < lines.length; index++) {
          try {
            const values = parseLine(lines[index]);
            const raw = Object.fromEntries(
              headers.map((header, column) => [header, values[column] ?? ""]),
            );
            const input = await crmSchemas[resource].parseAsync(raw);
            await createCrmRecord(client, context, resource, input);
            succeeded++;
          } catch (error) {
            errors.push({
              row: index + 1,
              message: error instanceof Error ? error.message : "Import failed",
            });
          }
        }
        return {
          succeeded,
          failed: errors.length,
          errors: errors.slice(0, 100),
        };
      },
    );
    await audit({
      organizationId: context.organizationId,
      actorUserId: session.userId,
      eventType: `crm.${resource}.imported`,
      entityType: resource,
      afterData: result,
      request,
    });
    return ok({
      message: `Imported ${result.succeeded} records; ${result.failed} failed.`,
      ...result,
    });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
