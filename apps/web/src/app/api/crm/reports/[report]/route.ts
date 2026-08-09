import { getCrmReport } from "@vercentlabs/api";
import { rowsToCsv } from "@vercentlabs/reporting-engine";
import { getSessionContext } from "@/lib/auth";
import { crmApiContext, rethrowCrmError } from "@/lib/crm";
import { requireCrmReportView } from "@/lib/crm-api";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";
function reportLabel(value: string) {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function csvValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "")).join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${reportLabel(key)}: ${String(item ?? "")}`)
      .join("; ");
  }
  return value;
}

function csvFileName(report: string) {
  const safeName =
    report
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "report";
  return `crm-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`;
}

export async function GET(
  request: Request,
  route: { params: Promise<{ report: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    const { report } = await route.params;
    requireCrmReportView(session, report);
    const url = new URL(request.url);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      getCrmReport(
        client,
        context,
        report,
        Object.fromEntries(url.searchParams.entries()),
      ),
    );
    if (url.searchParams.get("format") === "csv") {
      const rows = Array.isArray((result as { rows?: unknown }).rows)
        ? ((result as { rows: Array<Record<string, unknown>> }).rows ?? [])
        : [];
      const keys = Array.from(
        new Set(rows.flatMap((row) => Object.keys(row))),
      );
      const columns = keys.map((key) => ({
        key,
        label: reportLabel(key),
      }));
      const safeRows = rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, csvValue(value)]),
        ),
      );
      const csv = columns.length
        ? rowsToCsv(columns, safeRows)
        : "\uFEFFNo report data\r\n";

      return new Response(csv, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${csvFileName(report)}"`,
          "Content-Type": "text/csv; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return ok(result);
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
