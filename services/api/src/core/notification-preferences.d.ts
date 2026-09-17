export declare class NotificationPreferenceError extends Error {
  status: number;
}
export declare function setNotificationPreference(client: any, session: any, input: any): Promise<void>;
export declare function listNotificationPreferences(client: any, session: any): Promise<any[]>;
