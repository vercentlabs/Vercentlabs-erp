export function resolveMemberExecutionContext(
  client: { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> },
  organizationId: string,
  input: { userId: string },
): Promise<Readonly<{ organizationId: string; userId: string; permissions: string[]; roleSlugs: string[]; emailVerified: boolean }> | null>;
