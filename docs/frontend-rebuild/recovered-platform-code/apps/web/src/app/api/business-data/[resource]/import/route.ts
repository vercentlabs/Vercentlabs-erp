import { createHash } from "node:crypto";

import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import {
  beginImportJob,
  completeImportJob,
  createBusinessDataRecord,
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

type ImportOutcomeStatus = "completed" | "completed_with_errors" | "failed";

type ImportOutcome = {
  jobId: string;
  status: ImportOutcomeStatus;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
  errors: Array<{ row: number; message: string }>;
  replayed: boolean;
};

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isImportOutcomeStatus(value: unknown): value is ImportOutcomeStatus {
  return value === "completed" || value === "completed_with_errors" || value === "failed";
}

function parseStoredImportOutcome(value: unknown): Omit<ImportOutcome, "replayed"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(
      409,
      "The prior import result is unavailable for replay.",
      "BUSINESS_DATA_IMPORT_REPLAY_UNAVAILABLE",
    );
  }

  const stored = value as Record<string, unknown>;
  const status = stored.status;
  const errors = stored.errors;
  if (
    typeof stored.jobId !== "string" ||
    !isImportOutcomeStatus(status) ||
    !isNonNegativeInteger(stored.processedRows) ||
    !isNonNegativeInteger(stored.succeededRows) ||
    !isNonNegativeInteger(stored.failedRows) ||
    !Array.isArray(errors) ||
    !errors.every(
      (entry): entry is { row: number; message: string } =>
        Boolean(entry) &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        isPositiveInteger((entry as Record<string, unknown>).row) &&
        typeof (entry as Record<string, unknown>).message === "string",
    )
  ) {
    throw new HttpError(
      409,
      "The prior import result is invalid and cannot be replayed safely.",
      "BUSINESS_DATA_IMPORT_REPLAY_INVALID",
    );
  }

  if (
    stored.processedRows !== stored.succeededRows + stored.failedRows ||
    errors.length !== stored.failedRows ||
    (status === "completed" && stored.failedRows !== 0) ||
    (status === "completed_with_errors" &&
      (stored.succeededRows === 0 || stored.failedRows === 0)) ||
    (status === "failed" && stored.succeededRows !== 0)
  ) {
    throw new HttpError(
      409,
      "The prior import result is internally inconsistent and cannot be replayed safely.",
      "BUSINESS_DATA_IMPORT_REPLAY_INVALID",
    );
  }

  return {
    jobId: stored.jobId,
    status,
    processedRows: stored.processedRows,
    succeededRows: stored.succeededRows,
    failedRows: stored.failedRows,
    errors,
  };
}

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
    const requestedIdempotencyKey = String(request.headers.get("idempotency-key") || "").trim();
    if (!requestedIdempotencyKey || requestedIdempotencyKey.length > 200 || !/^[A-Za-z0-9._:-]{8,200}$/.test(requestedIdempotencyKey)) {
      throw new HttpError(400, "A valid Idempotency-Key (8-200 characters) is required for imports.", "BUSINESS_DATA_IMPORT_IDEMPOTENCY_REQUIRED");
    }
    const importFingerprint = createHash("sha256")
      .update(JSON.stringify({ resource, fileName: envelope.fileName || null, rows: envelope.rows }))
      .digest("hex");
    const meteringKey = requestedIdempotencyKey;
    await incrementBillingUsage(session.organizationId, "api_requests_monthly", 1, {
      idempotencyKey: `business-import:api:${resource}:${meteringKey}`,
      source: "business-data-import",
    });
    await incrementBillingUsage(
      session.organizationId,
      "imports_rows_monthly",
      envelope.rows.length,
      {
        idempotencyKey: `business-import:rows:${resource}:${meteringKey}`,
        source: "business-data-import",
      },
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

    const outcome = await tenantTransaction<ImportOutcome>(
      context.organizationId,
      async (client) => {
        const job = await beginImportJob(client, context, resource, {
          fileName: envelope.fileName,
          totalRows: parsedRows.length,
          idempotencyKey: requestedIdempotencyKey,
          requestFingerprint: importFingerprint,
        });
        if (job.replayed) {
          if (job.status === "processing" || job.status === "pending") {
            throw new HttpError(409, "An import with this Idempotency-Key is still in progress. Retry after it completes.", "BUSINESS_DATA_IMPORT_IN_PROGRESS");
          }
          const replay = parseStoredImportOutcome(job.resultPayload);
          return { ...replay, replayed: true };
        }
        const jobId = job.id;

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

        const completed: ImportOutcome = {
          jobId,
          status,
          processedRows: parsedRows.length,
          succeededRows,
          failedRows: errors.length,
          errors,
          replayed: false,
        };
        await completeImportJob(client, context, jobId, {
          status,
          processedRows: parsedRows.length,
          succeededRows,
          failedRows: errors.length,
          errors,
          resultPayload: completed,
        });

        return completed;
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
        replayed: outcome.replayed,
      },
      request,
    });

    return ok(
      {
        message:
          outcome.replayed
            ? "Import retry replayed the original result; no rows were processed twice."
            : outcome.failedRows === 0
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
