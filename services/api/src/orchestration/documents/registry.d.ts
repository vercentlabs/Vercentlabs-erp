type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string; activeCompanyId?: string | null; activeBranchId?: string | null; permissions: string[]; roleSlugs: string[] };
export type DocumentRenderer = Readonly<{ key: string; moduleKey: string; permission: string; label: string }>;
export const DOCUMENT_RENDERERS: readonly DocumentRenderer[];
export function getDocumentRenderer(key: string): DocumentRenderer | null;
export function renderAuthorizedDocument(client: Client, session: Session, key: string, id: string): Promise<{ fileName: string; body: Buffer }>;
