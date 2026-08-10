import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { listAuditEvents } from "@/lib/audit/query";
import { redactAuditPayload } from "@/lib/audit/redact";
import { csvCell } from "@/lib/csv";
import { errorResponse, HttpError } from "@/lib/http";
import { audit } from "@/lib/security";

// Prompt 9, Part 16/43: permission-protected, tenant-scoped, server-side
// filtered (the exact same filters the Audit Events page applies — no
// separate/wider export path), bounded (never "every audit event ever"),
// and redacted identically to the on-screen view — export is never a
// bypass around the UI's masking. Self-audits, following the same
// precedent as business-data's export route.
const EXPORT_ROW_LIMIT = 5_000;

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }
    requirePermissionFromSession(session, PERMISSIONS.auditView);

    const url = new URL(request.url);
    const filters = {
      search: url.searchParams.get("q") || undefined,
      eventTypePrefix: url.searchParams.get("event") || undefined,
      entityType: url.searchParams.get("entityType") || undefined,
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
    };

    const { rows, total } = await listAuditEvents(session.organizationId, {
      ...filters,
      page: 1,
      pageSize: EXPORT_ROW_LIMIT,
    });

    const columns = [
      "created_at",
      "event_type",
      "entity_type",
      "entity_id",
      "actor_name",
      "actor_email",
      "ip_address",
      "metadata",
      "before_data",
      "after_data",
    ];
    const lines = [
      columns.map(csvCell).join(","),
      ...rows.map((row) =>
        [
          row.created_at.toISOString(),
          row.event_type,
          row.entity_type,
          row.entity_id,
          row.actor_name,
          row.actor_email,
          row.ip_address,
          JSON.stringify(redactAuditPayload(row.metadata) ?? {}),
          JSON.stringify(redactAuditPayload(row.before_data) ?? null),
          JSON.stringify(redactAuditPayload(row.after_data) ?? null),
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
    const csv = `﻿${lines.join("\r\n")}\r\n`;

    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "audit.events.exported",
      entityType: "audit_event",
      afterData: { rowCount: rows.length, totalMatched: total, filters },
      request,
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vercentlabs-audit-events-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
