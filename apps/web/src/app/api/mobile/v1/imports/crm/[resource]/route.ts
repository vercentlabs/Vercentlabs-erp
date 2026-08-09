import { createCrmRecord } from "@vercentlabs/api";

import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmApiContext, isCrmDefinition, rethrowCrmError } from "@/lib/crm";
import { requireCrmManage } from "@/lib/crm-api";
import { crmSchemas } from "@/lib/crm-validation";
import { parseCsv } from "@/lib/csv";
import { tenantTransaction } from "@/lib/db";
import { HttpError, readJson } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
import { audit } from "@/lib/security";

export async function POST(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    if (!session.organizationId) throw new HttpError(401, "Workspace required.");
    requirePermissionFromSession(session, PERMISSIONS.crmImport);
    const { resource } = await route.params;
    if (!isCrmDefinition(resource)) throw new HttpError(404, "Unknown CRM resource.");
    requireCrmManage(session, resource);

    const input = (await readJson(request)) as { csv?: unknown };
    if (typeof input.csv !== "string") throw new HttpError(400, "CSV content is required.");
    if (new TextEncoder().encode(input.csv).byteLength > 2_000_000) {
      throw new HttpError(413, "CSV must be 2 MB or smaller.");
    }
    const rows = parseCsv(input.csv);
    if (rows.length < 2) throw new HttpError(400, "CSV must include a header and at least one record.");
    if (rows.length > 1001) throw new HttpError(400, "Import a maximum of 1,000 records at a time.");
    const headers = rows[0].map((header) => header.trim());
    if (new Set(headers).size !== headers.length || headers.some((header) => !header)) {
      throw new HttpError(400, "CSV headers must be unique and non-empty.");
    }

    await requireBillingWriteAccess(session.organizationId);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => {
      let succeeded = 0;
      const errors: Array<{ row: number; message: string }> = [];
      for (let index = 1; index < rows.length; index += 1) {
        const rowNumber = index + 1;
        const savepoint = `mobile_crm_import_${rowNumber}`;
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
          const values = rows[index];
          const raw = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
          const parsed = await crmSchemas[resource].parseAsync(raw);
          await createCrmRecord(client, context, resource, parsed);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          succeeded += 1;
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          errors.push({ row: rowNumber, message: error instanceof Error ? error.message : "Import failed" });
        }
      }
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: `crm.${resource}.imported`,
        entityType: resource,
        afterData: { succeeded, failed: errors.length, client: "mobile" },
        request,
        client,
      });
      return { succeeded, failed: errors.length, errors: errors.slice(0, 100) };
    });
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    if (result.succeeded) await incrementBillingUsage(session.organizationId, "imports_rows_monthly", result.succeeded);
    return mobileOk(request, { message: `Imported ${result.succeeded} records; ${result.failed} failed.`, ...result });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return mobileError(request, mapped);
    }
  }
}
