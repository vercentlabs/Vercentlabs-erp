export function resetReadinessCacheForTests(): void;
export function checkReadiness(options: {
  queryable: { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
  env?: Record<string, string | undefined>;
  target?: "web" | "worker";
  timeoutMs?: number;
  storage?: { probe(): Promise<boolean> };
}): Promise<{ ready: boolean; checks: Record<string, "ok" | "failed">; failures: Array<{ check: string; error: string }> }>;
