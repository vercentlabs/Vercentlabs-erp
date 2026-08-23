import { createHash } from "node:crypto";

import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { createCrmRecord } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, isCrmDefinition, rethrowCrmError } from "@/modules/crm";
import { requireCrmManage } from "@/modules/crm/api";
import { crmSchemas } from "@/modules/crm/validation";
import { parseCsv } from "@/core/csv";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { assertSameOrigin, audit, readRequestBytes } from "@/core/security";

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
    requireCrmManage(session, resource);

    const bytes = await readRequestBytes(request, 2_000_000);
    const csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const fileName =
      request.headers.get("x-import-file-name")?.trim().slice(0, 240) ||
      `${resource}-import.csv`;
    const rows = parseCsv(csv);
    if (rows.length < 2)
      throw new HttpError(
        400,
        "CSV must include a header and at least one record.",
      );
    if (rows.length > 1001)
      throw new HttpError(400, "Import a maximum of 1,000 records at a time.");

    const headers = rows[0].map((header) => header.trim());
    if (
      new Set(headers).size !== headers.length ||
      headers.some((header) => !header)
    ) {
      throw new HttpError(400, "CSV headers must be unique and non-empty.");
    }

    await requireBillingWriteAccess(session.organizationId);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`crm-import:${context.organizationId}:${resource}`],
        );
        const claimed = await client.query(
          `INSERT INTO tenant.crm_import_receipts(
             organization_id,resource,file_name,content_hash,total_rows,created_by
           ) VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (organization_id,resource,content_hash) DO NOTHING
           RETURNING id`,
          [
            context.organizationId,
            resource,
            fileName,
            contentHash,
            rows.length - 1,
            session.userId,
          ],
        );
        if (!claimed.rows[0]) {
          const existing = await client.query(
            `SELECT id,status,total_rows,succeeded_rows,failed_rows,error_details
             FROM tenant.crm_import_receipts
             WHERE organization_id=$1 AND resource=$2 AND content_hash=$3`,
            [context.organizationId, resource, contentHash],
          );
          const receipt = existing.rows[0];
          if (!receipt)
            throw new HttpError(409, "The import could not be claimed safely.");
          return {
            importId: receipt.id,
            succeeded: Number(receipt.succeeded_rows || 0),
            failed: Number(receipt.failed_rows || 0),
            skipped: Math.max(
              0,
              Number(receipt.total_rows || 0) -
                Number(receipt.succeeded_rows || 0) -
                Number(receipt.failed_rows || 0),
            ),
            errors: Array.isArray(receipt.error_details)
              ? receipt.error_details
              : [],
            replayed: true,
            inProgress: receipt.status === "processing",
          };
        }

        let succeeded = 0;
        let skipped = 0;
        const errors: Array<{ row: number; message: string }> = [];
        for (let index = 1; index < rows.length; index += 1) {
          const rowNumber = index + 1;
          const savepoint = `crm_import_row_${rowNumber}`;
          await client.query(`SAVEPOINT ${savepoint}`);
          try {
            const values = rows[index];
            const raw = Object.fromEntries(
              headers.map((header, column) => [header, values[column] ?? ""]),
            );
            const input = await crmSchemas[resource].parseAsync(raw);
            if (resource === "leads") {
              const email = String(input.email || "").trim() || null;
              const phone =
                String(input.mobile || input.phone || "").trim() || null;
              const duplicate = await client.query(
                `SELECT id FROM tenant.crm_leads
                 WHERE organization_id=$1 AND status<>'archived'
                   AND (($2::text IS NOT NULL AND normalized_email=tenant.crm_normalize_email($2))
                     OR ($3::text IS NOT NULL AND normalized_phone=tenant.crm_normalize_phone($3)))
                 LIMIT 1`,
                [context.organizationId, email, phone],
              );
              if (duplicate.rows[0]) {
                skipped += 1;
                await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                continue;
              }
            }
            await createCrmRecord(client, context, resource, input);
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            succeeded += 1;
          } catch (error) {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            errors.push({
              row: rowNumber,
              message: error instanceof Error ? error.message : "Import failed",
            });
          }
        }
        const importResult = {
          importId: claimed.rows[0].id,
          succeeded,
          skipped,
          failed: errors.length,
          errors: errors.slice(0, 100),
          replayed: false,
          inProgress: false,
        };
        await client.query(
          `UPDATE tenant.crm_import_receipts
           SET status=$3,total_rows=$4,succeeded_rows=$5,failed_rows=$6,
               error_details=$7::jsonb,completed_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [
            context.organizationId,
            claimed.rows[0].id,
            errors.length ? "completed_with_errors" : "completed",
            rows.length - 1,
            succeeded,
            errors.length,
            JSON.stringify(errors.slice(0, 100)),
          ],
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `crm.${resource}.imported`,
          entityType: resource,
          afterData: importResult,
          request,
          client,
        });
        return importResult;
      },
    );

    if (!result.replayed)
      await incrementBillingUsage(
        session.organizationId,
        "api_requests_monthly",
      );
    if (!result.replayed && result.succeeded) {
      await incrementBillingUsage(
        session.organizationId,
        "imports_rows_monthly",
        result.succeeded,
      );
    }
    return ok(
      {
        message: result.inProgress
          ? "This file is already being imported. No second import was started."
          : result.replayed
            ? `This file was already imported. No duplicate records were created. Original result: ${result.succeeded} imported; ${result.skipped} duplicates skipped; ${result.failed} failed.`
            : `Imported ${result.succeeded} records; ${result.skipped} duplicates skipped; ${result.failed} failed.`,
        ...result,
      },
      result.inProgress ? 202 : 200,
    );
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
