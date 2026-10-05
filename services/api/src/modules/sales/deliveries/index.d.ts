type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type FileOptions = Record<string, unknown>;

export type SalesDeliveryStatus = "draft" | "ready" | "dispatched" | "delivered" | "cancelled";

export class SalesDeliveryError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const DELIVERY_STATUS: Readonly<Record<SalesDeliveryStatus, SalesDeliveryStatus>>;
export const DELIVERY_STATUS_LABELS: Readonly<Record<SalesDeliveryStatus, string>>;
export const DELIVERY_PERMISSIONS: Readonly<Record<"view" | "viewAll" | "create" | "edit" | "dispatch" | "deliver" | "cancel" | "print" | "changeWarehouse" | "invoice", string>>;
export const DELIVERY_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export const DELIVERY_CANCEL_REASONS: ReadonlyArray<{ code: string; label: string }>;
export const SALES_DELIVERY_FILE_ENTITY: "sales.delivery";

type ShipmentInput = {
  carrier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null; vehicleReference?: string | null;
  expectedDeliveryDate?: string | null; packageCount?: number | string | null; packageNotes?: string | null;
};
type DeliveryLineInput = Array<{ salesOrderLineId: string; quantity: number | string }>;

export function getDeliveryProposal(client: QueryClient, context: Context, orderId: string): Promise<{ orderId: string; canDeliver: boolean; lines: any[]; services: any[] }>;
export function createDeliveryFromSalesOrder(client: QueryClient, context: Context, orderId: string,
  input: ShipmentInput & {
    idempotencyKey: string; lines?: DeliveryLineInput; warehouseId?: string | null; deliveryInstructions?: string | null; internalNotes?: string | null;
    dispatch?: boolean; dispatchDate?: string | null;
  },
): Promise<{ deliveryId: string; deliveryNumber: string; status: SalesDeliveryStatus; replayed: boolean; fulfillmentStatus?: string }>;
export function updateDraftDelivery(client: QueryClient, context: Context, deliveryId: string,
  input: {
    expectedVersion?: number | null; lines?: DeliveryLineInput; shippingAddressId?: string; addressChangeReason?: string | null; contactId?: string | null;
    expectedDeliveryDate?: string | null; deliveryInstructions?: string | null; internalNotes?: string | null; packageCount?: number | string | null; packageNotes?: string | null;
  },
): Promise<{ deliveryId: string; version: number; changed: boolean; changes?: any[] }>;
export function getDelivery(client: QueryClient, context: Context, deliveryId: string): Promise<{
  delivery: Record<string, any>; lines: any[]; invoices: any[]; stockMovements: any[]; events: any[]; cancelReasons: ReadonlyArray<{ code: string; label: string }>;
  actions: Record<string, boolean>;
}>;
export function listDeliveries(client: QueryClient, context: Context, filters?: Record<string, string | undefined>): Promise<{
  rows: any[]; total: number; limit: number; offset: number; views: ReadonlyArray<{ key: string; label: string }>; capabilities: Record<string, boolean>;
}>;

export function markDeliveryReady(client: QueryClient, context: Context, deliveryId: string, input?: { expectedVersion?: number | null }): Promise<{ deliveryId: string; status: SalesDeliveryStatus; changed: boolean }>;
export function returnDeliveryToDraft(client: QueryClient, context: Context, deliveryId: string, input?: { expectedVersion?: number | null; reason?: string | null }): Promise<{ deliveryId: string; status: SalesDeliveryStatus; changed: boolean }>;
export function dispatchDelivery(client: QueryClient, context: Context, deliveryId: string,
  input?: { dispatchDate?: string | null; carrier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null; vehicleReference?: string | null; packageCount?: number | string | null; expectedVersion?: number | null },
): Promise<{ deliveryId: string; deliveryNumber: string; status: SalesDeliveryStatus; replayed: boolean; dispatchDate?: string; orderStatus?: string; fulfillmentStatus?: string }>;
export function markDeliveryDelivered(client: QueryClient, context: Context, deliveryId: string, input?: { deliveredAt?: string | null; receivedBy?: string | null; note?: string | null }): Promise<any>;
export function cancelDelivery(client: QueryClient, context: Context, deliveryId: string, input: { reasonCode: string; reason?: string | null }): Promise<{ deliveryId: string; status: SalesDeliveryStatus; changed: boolean }>;
export function updateShipmentDetails(client: QueryClient, context: Context, deliveryId: string, input: ShipmentInput & { expectedVersion?: number | null }): Promise<{ deliveryId: string; changed: boolean; version: number; changes?: any[] }>;
export function changeDeliveryWarehouse(client: QueryClient, context: Context, deliveryId: string, input: { warehouseId: string; reason?: string | null }): Promise<{ deliveryId: string; changed: boolean; warehouseId?: string }>;

export function getDeliveryNote(client: QueryClient, context: Context, deliveryId: string): Promise<{ delivery: Record<string, any>; lines: any[]; currency: string | null; showPrices: boolean; company: { name: string | null; taxId: string | null } }>;

export function prepareDeliveryFileUpload(input: { fileName: string; bytes: Uint8Array }, env?: Record<string, string | undefined>): Promise<any>;
export function listDeliveryFiles(client: QueryClient, context: Context, deliveryId: string): Promise<Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>>;
export function uploadDeliveryFile(client: QueryClient, context: Context, deliveryId: string, input: { prepared: unknown }, options?: FileOptions): Promise<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
export function removeDeliveryFile(client: QueryClient, context: Context, deliveryId: string, fileId: string): Promise<{ removed: true }>;
export function readDeliveryFile(client: QueryClient, context: Context, deliveryId: string, fileId: string, options?: FileOptions): Promise<{ fileName: string; mimeType: string; body: Uint8Array }>;
