// Prompt 9 (Governance Foundation) — the single, shared, bounded query
// surface every Audit Logs view (Audit Events, Record History, User
// Activity, Security Events, Export) reads through. A fixed, validated
// set of filter dimensions only (date range, event-type prefix, actor,
// entity type/id, page) — no client-controlled sort column and no
// free-form SQL-filter builder (Part 12/39). Every query is scoped to the
// caller's own organization_id as $1, always.
import { query } from "@/core/db";
import {
  sanitizeDate,
  sanitizeEventTypePrefix,
  sanitizePage,
  sanitizePageSize,
} from "@/core/audit/sanitize";

export { sanitizePage, sanitizePageSize } from "@/core/audit/sanitize";

export type AuditEventRow = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  before_data: unknown;
  after_data: unknown;
  created_at: Date;
};

export type LoginEventRow = {
  id: string;
  user_id: string | null;
  email: string;
  succeeded: boolean;
  reason: string | null;
  ip_address: string | null;
  created_at: Date;
};

export type AuditEventFilters = {
  dateFrom?: string;
  dateTo?: string;
  eventTypePrefix?: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  /** Free-text match against entity_type / entity_id / actor email only — the same 3 columns the original audit-logs page already searched, moved here unchanged. */
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function listAuditEvents(
  organizationId: string,
  filters: AuditEventFilters = {},
): Promise<{ rows: AuditEventRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = sanitizePageSize(filters.pageSize);
  const page = sanitizePage(filters.page);
  const offset = (page - 1) * pageSize;

  const params: unknown[] = [organizationId];
  const conditions: string[] = ["a.organization_id = $1"];

  const dateFrom = sanitizeDate(filters.dateFrom);
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`a.created_at >= $${params.length}`);
  }
  const dateTo = sanitizeDate(filters.dateTo);
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`a.created_at <= $${params.length}`);
  }
  const eventTypePrefix = sanitizeEventTypePrefix(filters.eventTypePrefix);
  if (eventTypePrefix) {
    params.push(`${eventTypePrefix}%`);
    conditions.push(`a.event_type LIKE $${params.length}`);
  }
  if (filters.actorUserId) {
    params.push(filters.actorUserId);
    conditions.push(`a.actor_user_id = $${params.length}`);
  }
  if (filters.entityType) {
    params.push(filters.entityType.slice(0, 120));
    conditions.push(`a.entity_type = $${params.length}`);
  }
  if (filters.entityId) {
    params.push(filters.entityId.slice(0, 200));
    conditions.push(`a.entity_id = $${params.length}`);
  }
  const search = filters.search?.trim().slice(0, 200);
  if (search) {
    params.push(`%${search}%`);
    const parameter = `$${params.length}`;
    conditions.push(
      `(a.entity_type ILIKE ${parameter} OR COALESCE(a.entity_id,'') ILIKE ${parameter} OR COALESCE(u.email,'') ILIKE ${parameter})`,
    );
  }

  const where = conditions.join(" AND ");

  const [{ count }] = await query<{ count: number }>(
    search
      ? `SELECT count(*)::int AS count FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id WHERE ${where}`
      : `SELECT count(*)::int AS count FROM audit_events a WHERE ${where}`,
    params,
  );

  const rowParams = [...params, pageSize, offset];
  const rows = await query<AuditEventRow>(
    `SELECT a.id, a.event_type, a.entity_type, a.entity_id, a.actor_user_id,
            u.full_name AS actor_name, u.email AS actor_email,
            a.ip_address, a.metadata, a.before_data, a.after_data, a.created_at
       FROM audit_events a
       LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
    rowParams,
  );

  return { rows, total: count || 0, page, pageSize };
}

// Security Events: a fixed, hardcoded (never client-controlled) category
// of event_type values — auth.*, access.* (role/permission/invitation
// changes) and module.status_changed. No dedicated security_events table
// exists (confirmed by audit), so this reads the same audit_events table
// with a narrower, non-negotiable WHERE clause.
export async function listSecurityAuditEvents(
  organizationId: string,
  filters: Pick<AuditEventFilters, "dateFrom" | "dateTo" | "page" | "pageSize"> = {},
): Promise<{ rows: AuditEventRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = sanitizePageSize(filters.pageSize);
  const page = sanitizePage(filters.page);
  const offset = (page - 1) * pageSize;

  const params: unknown[] = [organizationId];
  const conditions: string[] = [
    "a.organization_id = $1",
    "(a.event_type LIKE 'auth.%' OR a.event_type LIKE 'access.%' OR a.event_type = 'module.status_changed')",
  ];
  const dateFrom = sanitizeDate(filters.dateFrom);
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`a.created_at >= $${params.length}`);
  }
  const dateTo = sanitizeDate(filters.dateTo);
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`a.created_at <= $${params.length}`);
  }
  const where = conditions.join(" AND ");

  const [{ count }] = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_events a WHERE ${where}`,
    params,
  );
  const rowParams = [...params, pageSize, offset];
  const rows = await query<AuditEventRow>(
    `SELECT a.id, a.event_type, a.entity_type, a.entity_id, a.actor_user_id,
            u.full_name AS actor_name, u.email AS actor_email,
            a.ip_address, a.metadata, a.before_data, a.after_data, a.created_at
       FROM audit_events a
       LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
    rowParams,
  );
  return { rows, total: count || 0, page, pageSize };
}

// login_events has no organization_id column (a failed login with an
// unrecognized email can't be attributed to any org). The INNER JOIN
// against organization_memberships is what makes this tenant-safe: a row
// only ever surfaces if its user_id is a real member of the caller's own
// organization — an unattributable row (user_id IS NULL, or a user who
// isn't a member of this org) is excluded by construction, never guessed
// at via email domain matching.
export async function listLoginEvents(
  organizationId: string,
  filters: { page?: number; pageSize?: number } = {},
): Promise<{ rows: LoginEventRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = sanitizePageSize(filters.pageSize);
  const page = sanitizePage(filters.page);
  const offset = (page - 1) * pageSize;

  const [{ count }] = await query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM login_events le
       JOIN organization_memberships om ON om.user_id = le.user_id AND om.organization_id = $1`,
    [organizationId],
  );
  const rows = await query<LoginEventRow>(
    `SELECT le.id, le.user_id, le.email, le.succeeded, le.reason, le.ip_address, le.created_at
       FROM login_events le
       JOIN organization_memberships om ON om.user_id = le.user_id AND om.organization_id = $1
      ORDER BY le.created_at DESC
      LIMIT $2 OFFSET $3`,
    [organizationId, pageSize, offset],
  );
  return { rows, total: count || 0, page, pageSize };
}
