type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };

export type ReservationTrackingStatus = "not_required" | "not_reserved" | "partially_reserved" | "fully_reserved";
export type FulfillmentTrackingStatus = "not_required" | "not_delivered" | "partially_delivered" | "delivered" | "complete" | "cancelled";
export type InvoiceTrackingStatus = "not_invoiced" | "partially_invoiced" | "fully_invoiced";
export type PaymentTrackingStatus = "not_invoiced" | "unpaid" | "partially_paid" | "paid" | "overdue";

export const SALES_ORDER_TRACKING_PERMISSIONS: Readonly<{ close: "sales.order.close"; reopenClosed: "sales.order.reopen_closed"; money: "sales.invoice.payments.view" }>;

// Pure derivations over an order row and its line quantities (orders/progress.js); the single place each status is decided.
export function deriveOrderStatus(order: Record<string, any>): { status: string; label: string; executing: boolean };
export function deriveReservationStatus(order: Record<string, any>, lines: any[]): Record<string, any> & { status: ReservationTrackingStatus; label: string };
export function deriveFulfillmentStatus(order: Record<string, any>, lines: any[]): Record<string, any> & { status: FulfillmentTrackingStatus; label: string };
export function deriveInvoiceStatus(order: Record<string, any>, lines: any[], positions: Map<string, any>, basis: string): Record<string, any> & { status: InvoiceTrackingStatus; label: string };
export function calculateOrderPaymentSummary(finance: { invoiced: number; credits: number; paid: number; balanceDue: number; overdueBalance: number }): {
  status: PaymentTrackingStatus; label: string; invoiced: number; credits: number; netBilled: number; paid: number; balanceDue: number; overdueBalance: number; percent: number;
};
export function calculateOrderWarnings(order: Record<string, any>, facts: Record<string, any>): Array<{ code: string; label: string; detail: string }>;
export function isOrderReadyToDeliver(order: Record<string, any>, lines: any[]): boolean;
export function isOrderReadyToInvoice(order: Record<string, any>, invoicing: Record<string, any>): boolean;
export function isOrderReadyToClose(order: Record<string, any>, fulfillment: Record<string, any>, invoicing: Record<string, any>): boolean;
export function buildOrderTimeline(client: QueryClient, context: Context, order: Record<string, any>, documents: Record<string, any>, options: { canSeeMoney: boolean }): Promise<any[]>;

// Where one order stands: its dimensions, lines, warnings, milestones, related documents and timeline.
export function getSalesOrderTracking(client: QueryClient, context: Context, orderId: string): Promise<any>;
export function closeSalesOrder(client: QueryClient, context: Context, orderId: string, input: { reason: string }): Promise<{
  orderId: string; status: string; changed: boolean; uninvoiced?: Array<{ item: string; quantity: number; unit: string | null }>;
}>;
export function reopenClosedSalesOrder(client: QueryClient, context: Context, orderId: string, input: { reason: string }): Promise<{ orderId: string; status: string; changed: boolean }>;
