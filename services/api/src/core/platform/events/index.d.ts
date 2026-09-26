type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

export type DomainEventDefinition = Readonly<{
  key: string;
  moduleKey: string;
  label: string;
  description: string;
  entityType: string;
  payloadVersion: number;
  project(event: { entityId: string; payload: Record<string, unknown> }): Record<string, unknown>;
  conditionFields: readonly { key: string; label: string; type?: "user" | "list" }[];
}>;
export const DOMAIN_EVENTS: readonly DomainEventDefinition[];
export function getDomainEvent(key: string): DomainEventDefinition | null;
export function projectDomainEvent(row: Record<string, any>): { id: string; type: string; version: number; occurredAt: string; module: string; entity: { type: string; id: string }; data: Record<string, unknown> } | null;
export function publishDomainEvent(
  client: Client,
  input: { organizationId: string; moduleKey?: string; eventType: string; entityType: string; entityId: string; payload?: Record<string, unknown> },
): Promise<string>;
export function dispatchPendingEvents(
  client: Client,
  organizationId: string,
  options?: { fanOut?: Array<(client: Client, event: Record<string, any>) => Promise<void>>; limit?: number },
): Promise<{ dispatched: number }>;
