type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string; roleSlugs?: readonly string[]; permissions?: readonly string[] };
export declare class RecordThreadError extends Error { status: number; code: string }
export const RECORD_THREAD_TYPES: Readonly<Record<string, { module: string | null; label: string; href: (id: string) => string }>>;
export function recordThreadType(type: string): { module: string | null; label: string; href: (id: string) => string };
export type RecordThread = {
  type: string; id: string; title: string;
  comments: Array<{ id: string; kind: "comment" | "note"; body: string | null; deleted: boolean; mentions: string[]; authorId: string | null; authorName: string | null; at: string; editedAt: string | null; mine: boolean }>;
  activities: Array<{ id: string; type: string; typeLabel: string; summary: string; note: string | null; dueDate: string; assignedTo: string; assigneeName: string | null; createdByName: string | null; status: string; doneAt: string | null; doneNote: string | null; overdue: boolean }>;
  followers: Array<{ userId: string; name: string }>;
  following: boolean;
  history: Array<{ event: string; label: string; at: string; by: string | null }>;
};
export function getRecordThread(client: Queryable, context: Context, type: string, id: string): Promise<RecordThread>;
export function addRecordComment(client: Queryable, context: Context, type: string, id: string, input: { body: string; kind?: "comment" | "note"; mentions?: string[] }): Promise<RecordThread>;
export function editRecordComment(client: Queryable, context: Context, type: string, id: string, commentId: string, input: { body: string }): Promise<RecordThread>;
export function deleteRecordComment(client: Queryable, context: Context, type: string, id: string, commentId: string): Promise<RecordThread>;
export function setRecordFollowing(client: Queryable, context: Context, type: string, id: string, following: boolean): Promise<RecordThread>;
export function scheduleRecordActivity(client: Queryable, context: Context, type: string, id: string, input: { type?: string; summary: string; note?: string; dueDate: string; assignedTo?: string }): Promise<RecordThread>;
export function closeRecordActivity(client: Queryable, context: Context, type: string, id: string, activityId: string, input?: { outcome?: "done" | "cancelled"; note?: string }): Promise<RecordThread>;
export function remindDueRecordActivities(client: Queryable, organizationId: string, options?: { today?: string | null }): Promise<number>;
