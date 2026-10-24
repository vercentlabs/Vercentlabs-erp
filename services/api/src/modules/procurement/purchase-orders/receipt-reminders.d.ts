// Receipt reminders (Procurement report Phase 2).
type Row = Record<string, any>;
export declare const RECEIPT_REMINDER_MODES: ReadonlyArray<{ code: string; label: string }>;
export declare function runReceiptReminders(client: any, context: any, options?: { today?: string; env?: Record<string, string | undefined> }): Promise<{ mode: string; sent: number; previewed: number; failed: number; skipped: number }>;
export declare function receiptRemindersOf(client: any, context: any, orderId: string): Promise<Row[]>;
export declare function updateReceiptReminderSettings(client: any, context: any, input?: Row): Promise<{ mode: string; daysBefore: number; daysAfter: number }>;
export declare function getReceiptReminderSettings(client: any, context: any): Promise<{ mode: string; daysBefore: number; daysAfter: number }>;
