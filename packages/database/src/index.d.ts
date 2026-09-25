export type QueryableClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount?: number | null;
  }>;
};

export function setTenantContext(
  client: QueryableClient,
  organizationId: string,
): Promise<void>;

export function runTenantTransaction<T, C extends QueryableClient = QueryableClient>(
  client: C,
  organizationId: string,
  work: (client: C) => Promise<T>,
): Promise<T>;
