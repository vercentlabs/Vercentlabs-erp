type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Viewer = { organizationId: string; userId: string };

export type NotificationCategory = {
  key: string;
  displayName: string;
  description: string;
  moduleKey: string;
  defaultInAppEnabled: boolean;
  userConfigurable: boolean;
};
export const NOTIFICATION_CHANNELS: readonly ["in_app"];
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[];
export function getNotificationCategory(key: string): NotificationCategory | null;

export class NotificationError extends Error {
  status: number;
  code: string;
}
export { NotificationError as NotificationPreferenceError };

export type NotificationRow = {
  id: string;
  category: string | null;
  module_key: string | null;
  title: string;
  message: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
  redacted?: boolean;
};

export function createNotification(
  client: Client,
  input: { organizationId: string; userId: string | null | undefined; category: string; title: string; message: string; href?: string | null; entityType?: string | null; entityId?: string | null },
): Promise<boolean>;
export function listNotifications(client: Client, session: Viewer, options?: { status?: "all" | "unread" | "read"; limit?: number }): Promise<NotificationRow[]>;
export function getUnreadNotificationCount(client: Client, session: Viewer): Promise<number>;
export function markNotificationRead(client: Client, session: Viewer, notificationId: string): Promise<{ id: string; read_at: string }>;
export function markAllNotificationsRead(client: Client, session: Viewer): Promise<{ updated: number }>;
export const REDACTED_NOTIFICATION: Readonly<{ title: string; message: string }>;
export function projectNotificationsForViewer(
  notifications: NotificationRow[],
  options: { accessibleModules: readonly string[]; adapters?: Record<string, (items: NotificationRow[]) => Promise<NotificationRow[]>> },
): Promise<NotificationRow[]>;
export type NotificationPreference = { category: string; displayName: string; description: string; moduleKey: string; channel: "in_app"; enabled: boolean };
export function listNotificationPreferences(client: Client, session: Viewer): Promise<NotificationPreference[]>;
export function setNotificationPreference(client: Client, session: Viewer, input: { category: string; channel?: string; enabled?: boolean }): Promise<{ category: string; channel: "in_app"; enabled: boolean }>;
