// Capability-owned CRM route implementation. The Next.js route file is a thin adapter only.
import { createHash } from "node:crypto";

import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { createCrmRecord, evaluateLeadDuplicateRisk, updateCrmRecord } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, isCrmDefinition, rethrowCrmError } from "@/modules/crm";
import { requireCrmManage } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmSchemas } from "@/modules/crm/crm-data-operations-and-customization/input-validation";
import { parseCsv } from "@/core/csv";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { assertSameOrigin, audit, readRequestBytes } from "@/core/security";

// F021 (Lead import and export) — LAST PROMPT 1/3 closeout: a dry run runs
// the EXACT same per-row parse/validate/create loop a real import runs (not
// a separately hand-written preview validator that could silently drift
// from real import behavior), inside the same transaction, then aborts via
// this sentinel instead of committing — so a dry run can never persist a
// row, claim the idempotency receipt slot a later real import needs, or
// consume billing usage, while still surfacing the exact succeeded/skipped/
// failed counts and row-level error messages a real import would produce.
class DryRunAbort extends Error {
  constructor(public readonly preview: Record<string, unknown>) {
    super("dry run");
  }
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
    if (resource !== "leads") throw new HttpError(404, "CRM import/export is available for leads only.");
    if (!isCrmDefinition(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    requireCrmManage(session, resource);
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    // F021 (Lead import and export) — LAST PROMPT 1/3 closeout: previously
    // import only ever created records — a row that exactly matched an
    // existing Lead was silently skipped, so re-uploading the same list
    // (e.g. a weekly export from an external system) could never update
    // status/owner/etc. on records it had already imported. "upsert" reuses
    // the SAME governed F008 exact-match classification
    // (evaluateLeadDuplicateRisk) as everywhere else in the module — only an
    // 'exact' match is upserted; a merely 'probable' match still creates a
    // new record rather than silently overwriting a possibly-different Lead.
    const modeParam = new URL(request.url).searchParams.get("mode");
    const upsert = modeParam === "upsert";

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

    if (!dryRun) await requireBillingWriteAccess(session.organizationId);
    const context = await crmApiContext(session);
    let result: Record<string, unknown>;
    try {
      result = await tenantTransaction(
        context.organizationId,
        async (client) => {
          let claimedId: string | null = null;
          if (!dryRun) {
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
            claimedId = claimed.rows[0].id;
          }

          let succeeded = 0;
          let updated = 0;
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
              // Even in dry-run mode this genuinely creates/updates the row
              // inside this transaction (for identical, non-drifting
              // validation and duplicate detection, including against other
              // rows earlier in this same file) — the whole transaction is
              // aborted below via DryRunAbort before it could ever commit.
              const exactMatch = upsert
                ? (await evaluateLeadDuplicateRisk(client, context, input))
                    .internalMatches.find((match) => match.classification === "exact")
                : null;
              if (exactMatch) {
                await updateCrmRecord(client, context, resource, exactMatch.row.id, input);
                await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                updated += 1;
              } else {
                await createCrmRecord(client, context, resource, input);
                await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                succeeded += 1;
              }
            } catch (error) {
              await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              await client.query(`RELEASE SAVEPOINT ${savepoint}`);
              if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                (error.code === "CRM_LEAD_DUPLICATE_EXACT" ||
                  error.code === "CRM_LEAD_CONVERTED_READ_ONLY")
              ) {
                skipped += 1;
                continue;
              }
              errors.push({
                row: rowNumber,
                message: error instanceof Error ? error.message : "Import failed",
              });
            }
          }

          if (dryRun) {
            throw new DryRunAbort({
              succeeded,
              updated,
              skipped,
              failed: errors.length,
              errors: errors.slice(0, 100),
              replayed: false,
              inProgress: false,
              dryRun: true,
            });
          }

          const importResult = {
            importId: claimedId,
            succeeded,
            updated,
            skipped,
            failed: errors.length,
            errors: errors.slice(0, 100),
            replayed: false,
            inProgress: false,
          };
          // crm_import_receipts has no separate updated_rows column — an
          // upsert's updates are folded into succeeded_rows for durable
          // idempotency-replay storage (the created/updated split above is
          // still visible in this run's own live response and audit event;
          // a replayed response after this pass just shows their combined
          // total, a deliberate, minor, documented limitation rather than a
          // schema migration for a secondary reporting nuance).
          await client.query(
            `UPDATE tenant.crm_import_receipts
             SET status=$3,total_rows=$4,succeeded_rows=$5,failed_rows=$6,
                 error_details=$7::jsonb,completed_at=now()
             WHERE organization_id=$1 AND id=$2`,
            [
              context.organizationId,
              claimedId,
              errors.length ? "completed_with_errors" : "completed",
              rows.length - 1,
              succeeded + updated,
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
    } catch (error) {
      if (error instanceof DryRunAbort) {
        result = error.preview;
      } else {
        throw error;
      }
    }

    const processedRows = (Number(result.succeeded) || 0) + (Number(result.updated) || 0);
    if (!dryRun && !result.replayed)
      await incrementBillingUsage(
        session.organizationId,
        "api_requests_monthly",
      );
    if (!dryRun && !result.replayed && processedRows) {
      await incrementBillingUsage(
        session.organizationId,
        "imports_rows_monthly",
        processedRows,
      );
    }
    const updatedCount = Number(result.updated) || 0;
    return ok(
      {
        message: dryRun
          ? `Dry run: ${result.succeeded} would import${updatedCount ? `; ${updatedCount} would update` : ""}; ${result.skipped} duplicates would be skipped; ${result.failed} would fail. No records were created.`
          : result.inProgress
            ? "This file is already being imported. No second import was started."
            : result.replayed
              ? `This file was already imported. No duplicate records were created. Original result: ${result.succeeded} imported; ${result.skipped} duplicates skipped; ${result.failed} failed.`
              : `Imported ${result.succeeded} records${updatedCount ? `; updated ${updatedCount} existing records` : ""}; ${result.skipped} duplicates skipped; ${result.failed} failed.`,
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
