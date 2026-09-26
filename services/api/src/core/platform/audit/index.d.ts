type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

export class AuditQueryError extends Error {
  status: number;
  code: string;
}
export type AuditFilters = {
  actorUserId?: string;
  area?: string;
  eventType?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};
export type AuditEventSummary = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: string;
};
export type AuditEventDetail = AuditEventSummary & {
  metadata: unknown;
  before: unknown;
  after: unknown;
  request: { ipAddress: string | null; userAgent: string | null } | null;
};
export function encodeAuditCursor(row: { created_at: string | Date; id: string }): string;
export function decodeAuditCursor(cursor: string): { at: string; id: string };
export function safeAuditPayload(value: unknown): unknown;
export function queryAuditEvents(client: Client, organizationId: string, filters?: AuditFilters): Promise<{ events: AuditEventSummary[]; nextCursor: string | null }>;
export function getAuditEvent(client: Client, organizationId: string, eventId: string): Promise<AuditEventDetail>;
export function listAuditActors(client: Client, organizationId: string): Promise<Array<{ id: string; name: string }>>;
