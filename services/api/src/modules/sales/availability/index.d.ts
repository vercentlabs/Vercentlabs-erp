type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };

export const SALES_AVAILABILITY_PERMISSIONS: Readonly<Record<"view" | "check" | "otherWarehouses" | "changeWarehouse", string>>;

export type AvailabilityResultKey = "available" | "partially_available" | "unavailable" | "not_required" | "not_tracked" | "no_warehouse";
export type AlternativeWarehouse = { warehouseId: string; warehouseCode: string; warehouseName: string; available: number; onHand?: number };
export type LineAvailability = {
  lineId: string; sequence: number; itemId: string; itemName: string; unit: string | null; isService: boolean; stockTracked: boolean;
  ordered: number; delivered: number; cancelled: number; reserved: number;
  remaining?: number; unreservedDemand?: number; baseUnit?: string | null; conversionFactor?: number;
  warehouseId?: string | null; warehouseName?: string | null; warehouseSource?: "line" | "order_default" | null;
  onHand?: number; reservedByOthers?: number; unusable?: number; available?: number; reservable?: number; shortage?: number;
  baseRequired?: number; baseAvailable?: number;
  result: AvailabilityResultKey; resultLabel: string; problem?: string | null; alternatives?: AlternativeWarehouse[];
};
export type OrderAvailability = {
  orderId: string; orderNumber: string; status: string; checkedAt: string; informational: boolean;
  summary: "fully_available" | "partially_available" | "unavailable" | "not_required"; summaryLabel: string; lines: LineAvailability[]; shortages: number;
};

export function checkSalesOrderAvailability(client: QueryClient, context: Context, orderId: string): Promise<OrderAvailability>;
export function checkLineAvailability(client: QueryClient, context: Context, orderId: string, lineId: string): Promise<OrderAvailability>;
export function checkWarehouseAvailability(client: QueryClient, context: Context, itemId: string): Promise<{
  itemId: string; itemName: string; unit: string | null; stockTracked: boolean; checkedAt: string;
  warehouses: Array<{ warehouseId: string; warehouseCode: string; warehouseName: string; onHand: number; reserved: number; unusable: number; available: number; held: number }>;
  totals: { onHand: number; reserved: number; available: number };
}>;
export function checkItemsAvailability(client: QueryClient, context: Context, input: { lines: Array<{ itemId: string; warehouseId?: string | null; quantity: number | string; uomId?: string | null }> }): Promise<{ checkedAt: string; lines: any[] }>;
export function changeSalesOrderLineWarehouse(client: QueryClient, context: Context, orderId: string, input: { lineId: string; warehouseId: string; reason?: string; reserve?: boolean }): Promise<{
  orderId: string; lineId: string; warehouseId: string; changed: boolean; reservationsReleased: number; reserved?: number; shortage?: number;
}>;
