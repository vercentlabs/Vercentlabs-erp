type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };

export const ORDER_CONFIRMATION_PERMISSIONS: Readonly<Record<string, string>>;
export const ORDER_CONFIRMATION_STATUS_LABELS: Readonly<Record<string, string>>;
export const ORDER_CONFIRMATION_SENT_CHANNELS: ReadonlyArray<{ code: string; label: string }>;
export const ORDER_CONFIRMATION_FILE_ENTITY: "sales.order_confirmation";

export type ConfirmationCheck = {
  orderId: string; orderNumber: string; status: string; versionNumber: number; ready: boolean; problems: string[]; warnings: string[];
  totals: { saved: string | null; recalculated: string | null; currencyCode: string };
  quotation: null | {
    quotationId: string; quotationNumber: string; quotationTotal: string; orderTotal: string; stillAccepted: boolean; differs: boolean;
    changes: Array<{ item: string; change: "removed" | "quantity" | "added"; from: number; to: number; unit: string | null }>;
  };
  varianceNeedsPermission: boolean;
  shortages: Array<{ itemName: string; unit: string | null; required: number; available: number | null; shortage: number | null; problem: string | null }>;
  reservesOnConfirm: boolean;
  nextConfirmationVersion: number;
};

export function validateSalesOrderForConfirmation(client: QueryClient, context: Context, orderId: string): Promise<ConfirmationCheck>;
export function confirmSalesOrder(client: QueryClient, context: Context, orderId: string, input?: { expectedVersionNumber?: number; quotationVarianceReason?: string }): Promise<{
  orderId: string; confirmed: boolean; status: string; changed: boolean; problems?: string[]; warnings?: string[]; confirmationId?: string | null; confirmationVersion?: number | null;
  fulfillmentStatus?: string; reservation?: any[]; shortages?: any[]; sourceOpportunityId?: string | null;
}>;
export function sendOrderConfirmation(client: QueryClient, context: Context, orderId: string, input: { to: string; cc?: string; subject?: string; message?: string; idempotencyKey: string },
  attachment: { fileName: string; content: Uint8Array } | null, env?: Record<string, string | undefined>): Promise<{ orderId: string; confirmationId: string; version: number; sentTo: string; messageId: string | null; replayed: boolean }>;
export function markOrderConfirmationSent(client: QueryClient, context: Context, orderId: string,
  input: { channel: string; recipient?: string; note?: string; sentAt?: string; idempotencyKey?: string }): Promise<{ orderId: string; confirmationId: string; version: number; replayed: boolean }>;
export function recordCustomerAcknowledgement(client: QueryClient, context: Context, orderId: string,
  input: { acknowledgedAt?: string; reference?: string; note?: string }): Promise<{ orderId: string; confirmationId: string; acknowledgedAt: unknown; changed: boolean }>;
export function getOrderConfirmation(client: QueryClient, context: Context, input: { confirmationId?: string | null; orderId?: string | null }): Promise<any>;
