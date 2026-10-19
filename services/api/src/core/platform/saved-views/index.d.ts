type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string; permissions?: readonly string[]; roleSlugs?: readonly string[] };
export type SavedListView = { id: string; listKey: string; name: string; state: Record<string, unknown>; shared: boolean; isDefault: boolean; mine: boolean; ownerName: string | null; updatedAt: string };
export class SavedListViewError extends Error { status: number; code: string }
export function listSavedListViews(client: Client, session: Session, listKey: string): Promise<{ views: SavedListView[]; canShare: boolean }>;
export function saveSavedListView(client: Client, session: Session, input: { listKey: string; name: string; state: Record<string, unknown>; shared?: boolean; isDefault?: boolean }): Promise<{ view: SavedListView }>;
export function setSavedListViewDefault(client: Client, session: Session, viewId: string, isDefault: boolean): Promise<{ view: SavedListView }>;
export function deleteSavedListView(client: Client, session: Session, viewId: string): Promise<{ deleted: true }>;
