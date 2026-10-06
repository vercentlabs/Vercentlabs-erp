// The Sales home: counts that open the order, quotation and invoice list views, and recent activity.
export type SalesHomeActivity = { id: string; at: string; kind: "quotation" | "order" | "delivery" | "invoice" | "return" | "credit_note"; documentId: string; number: string; verb: string; actor: string | null };
export type SalesHome = {
  quotationsAwaitingResponse: number | null;
  orders: Record<string, number> | null;
  invoiceBalance: { invoices: number; outstanding: number; overdue: number; currencyCode: string | null } | null;
  activity: SalesHomeActivity[];
};
export const HOME_ORDER_VIEWS: readonly string[];
export function getSalesHome(client: { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> }, context: { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] }): Promise<SalesHome>;
