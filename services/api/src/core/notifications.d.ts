export declare class NotificationError extends Error {
  status: number;
}
export declare function listNotifications(client: any, session: any, options?: { status?: "all" | "unread" | "read"; limit?: number }): Promise<any[]>;
export declare function getUnreadNotificationCount(client: any, session: any): Promise<number>;
export declare function markNotificationRead(client: any, session: any, notificationId: string): Promise<{ id: string; read_at: Date }>;
export declare function markAllNotificationsRead(client: any, session: any): Promise<{ updated: number }>;
