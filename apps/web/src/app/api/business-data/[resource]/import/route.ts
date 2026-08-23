import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import {
  completeImportJob,
  createBusinessDataRecord,
  createImportJob,
} from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import {
  businessDataContext,
  businessDataDefinitions,
  isBusinessDataDefinition,
  rethrowBusinessDataError,
} from "@/core/master-data";
import {
  businessDataImportEnvelopeSchema,
  businessDataSchemas,
} from "@/core/master-data-validation";
import { tenantTransaction } from "@/core/db";
import { errorResponse, fail, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

export async function POST(
  request: Request,
  routeContext: { params: Promise<{ resource: string }> },
) {
  try {
    assertSameOrigin(request);

    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }

    const { resource } = await routeContext.params;
    if (!isBusinessDataDefinition(resource)) {
      throw new HttpError(404, "Unknown business-data resource.");
    }

    const definition = businessDataDefinitions[resource];
    requirePermissionFromSession(session, definition.managePermission);
    requirePermissionFromSession(session, PERMISSIONS.businessDataImport);

    await requireBillingWriteAccess(session.organizationId);
    const envelope = businessDataImportEnvelopeSchema.parse(
      await readJson(request),
    );
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    await incrementBillingUsage(
      session.organizationId,
      "imports_rows_monthly",
      envelope.rows.length,
    );

    const parsedRows: Array<{
      rowNumber: number;
      data?: Record<string, unknown>;
      error?: string;
    }> = envelope.rows.map((row, index) => {
      const result = businessDataSchemas[resource].safeParse(row);
      if (result.success) {
        return {
          rowNumber: index + 1,
          data: result.data as Record<string, unknown>,
        };
      }

      return {
        rowNumber: index + 1,
        error:
          result.error.issues[0]?.message || "The row did not pass validation.",
      };
    });

    if (parsedRows.every((row) => !row.data)) {
      return fail("No import rows passed validation.", 400, {
        errors: parsedRows.map((row) => ({
          row: row.rowNumber,
          message: row.error,
        })),
      });
    }

    const context = businessDataContext(session);

    const outcome = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const jobId = await createImportJob(client, context, resource, {
          fileName: envelope.fileName,
          totalRows: parsedRows.length,
        });

        const errors: Array<{ row: number; message: string }> = [];
        let succeededRows = 0;

        for (const row of parsedRows) {
          if (!row.data) {
            errors.push({
              row: row.rowNumber,
              message: row.error || "Validation failed.",
            });
            continue;
          }

          const savepoint = `business_data_row_${row.rowNumber}`;
          await client.query(`SAVEPOINT ${savepoint}`);

          try {
            await createBusinessDataRecord(client, context, resource, row.data);
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            succeededRows += 1;
          } catch (error) {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            errors.push({
              row: row.rowNumber,
              message:
                error instanceof Error
                  ? error.message
                  : "The row could not be imported.",
            });
          }
        }

        const status =
          errors.length === 0
            ? "completed"
            : succeededRows > 0
              ? "completed_with_errors"
              : "failed";

        await completeImportJob(client, context, jobId, {
          status,
          processedRows: parsedRows.length,
          succeededRows,
          failedRows: errors.length,
          errors,
        });

        return {
          jobId,
          status,
          processedRows: parsedRows.length,
          succeededRows,
          failedRows: errors.length,
          errors,
        };
      },
    );

    await audit({
      organizationId: context.organizationId,
      actorUserId: session.userId,
      eventType: `business_data.${resource}.imported`,
      entityType: resource,
      entityId: outcome.jobId,
      afterData: {
        status: outcome.status,
        processedRows: outcome.processedRows,
        succeededRows: outcome.succeededRows,
        failedRows: outcome.failedRows,
      },
      request,
    });

    return ok(
      {
        message:
          outcome.failedRows === 0
            ? `${outcome.succeededRows} records imported.`
            : `${outcome.succeededRows} records imported; ${outcome.failedRows} rows require review.`,
        ...outcome,
      },
      outcome.failedRows === 0 ? 201 : 207,
    );
  } catch (error) {
    try {
      rethrowBusinessDataError(error);
    } catch (mappedError) {
      return errorResponse(mappedError);
    }
  }
}
