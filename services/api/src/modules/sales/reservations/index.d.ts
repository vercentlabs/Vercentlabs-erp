type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };

export const SALES_RESERVATION_PERMISSIONS: Readonly<Record<"view" | "viewAll" | "reserve" | "release", string>>;
export const SALES_RESERVATION_RELEASE_REASONS: ReadonlyArray<{ code: string; label: string }>;
export const SALES_RESERVATION_STATUS_LABELS: Readonly<Record<string, string>>;

export type ReservationOutcome = {
  lineId: string; itemName: string; unit: string | null; wanted: number; reserved: number; shortage: number; reservations: string[];
  warehouseId: string | null; warehouseName?: string; problem: string | null;
};
export type ReservationResult = {
  orderId: string; lines: ReservationOutcome[]; reservedLines: number; fulfillmentStatus: string;
  reservationStatus: "not_required" | "not_reserved" | "partially_reserved" | "fully_reserved"; replayed: boolean;
};

export function reserveSalesOrderStock(client: QueryClient, context: Context, orderId: string, input?: { lineIds?: string[]; idempotencyKey?: string }): Promise<ReservationResult>;
export function reserveSalesOrderLine(client: QueryClient, context: Context, orderId: string, input: { lineId: string; quantity?: number | string; idempotencyKey?: string }): Promise<ReservationResult>;
export function releaseSalesOrderReservation(client: QueryClient, context: Context, orderId: string, input: { lineId?: string; quantity?: number | string; reasonCode?: string; reason?: string }): Promise<{
  orderId: string; released: number; lines: Array<{ item: string; unit: string | null; quantity: number; count: number; reservations: string[] }>; fulfillmentStatus: string;
}>;
export function getSalesOrderReservations(client: QueryClient, context: Context, orderId: string): Promise<Array<{
  id: string; reservationNumber: string | null; status: string; statusLabel: string; lineId: string; itemName: string; unit: string | null;
  reserved: number; active: number; consumed: number; released: number; warehouseName: string; location: string | null; batch: string | null;
  reservedAt: string; reservedByName: string | null; releasedAt: string | null; releasedByName: string | null; releaseReason: string | null; daysHeld: number | null; stale: boolean;
  consumptions: Array<{ deliveryNumber: string | null; quantity: number; consumedAt: string }>;
}>>;
export function reconcileSalesReservations(client: QueryClient, context: Context, options?: { repair?: boolean }): Promise<{
  salesExcess: Array<{ orderId: string; orderNumber: string; lineId: string; item: string; reserved: number; needed: number }>;
  stock: { checked: number; mismatchCount: number; mismatches: Array<Record<string, unknown>>; repaired: number };
}>;
