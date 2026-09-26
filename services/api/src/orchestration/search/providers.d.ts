export const SEARCH_PROVIDERS: ReadonlyArray<{
  key: string;
  label: string;
  moduleKey: string;
  requiredPermission: string;
  execute(client: unknown, context: unknown, term: string, limit: number): Promise<Array<{ recordId: string; title: string; detail: string | null; href: string }>>;
}>;
