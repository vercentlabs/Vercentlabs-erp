export type DataExchangeDefinition = Readonly<{ key: string; kind: "import" | "export"; moduleKey: string; label: string; permissions: readonly string[]; maximumRows: number; artifactTtlHours?: number; stages: readonly string[] }>;
export const DATA_EXCHANGE_DEFINITIONS: readonly DataExchangeDefinition[];
export function getDataExchangeDefinition(key: string): DataExchangeDefinition | null;
