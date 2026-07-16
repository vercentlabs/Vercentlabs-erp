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
