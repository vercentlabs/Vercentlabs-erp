import type { NotificationRow } from "../../core/platform/notifications/index.js";

type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string; activeCompanyId?: string | null; activeBranchId?: string | null; permissions: readonly string[]; roleSlugs: readonly string[] };

export const NOTIFICATION_VISIBILITY_ADAPTERS: Readonly<Record<string, (client: Client, session: Session) => (items: NotificationRow[]) => Promise<NotificationRow[]>>>;
export function listNotificationsForViewer(client: Client, session: Session, options?: { status?: "all" | "unread" | "read"; accessibleModules?: readonly string[] }): Promise<NotificationRow[]>;
