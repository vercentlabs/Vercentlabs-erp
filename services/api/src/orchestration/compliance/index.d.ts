type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Session = { organizationId: string; userId: string; permissions?: readonly string[]; roleSlugs?: readonly string[] };
type Options = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch };
export type EInvoice = { id: string; documentNumber: string; irn: string | null; ackNumber: string | null; ackDate: string | null; signedQr: string | null; status: "generated" | "cancelled" | "failed"; error: string | null; cancelReason: string | null; cancelledAt: string | null; createdAt: string };
export type EwayBill = { id: string; sourceType: string; sourceId: string; sourceNumber: string; ewbNumber: string | null; ewbDate: string | null; validUntil: string | null; status: "generated" | "cancelled" | "failed"; vehicleNumber: string | null; transportMode: string | null; distanceKm: number | null; error: string | null; cancelReason: string | null; cancelledAt: string | null; partBUpdatedAt: string | null };
export class ComplianceError extends Error { status: number; code: string }
export const EWAY_BILL_THRESHOLD: number;
export function gspConfigured(env?: Record<string, string | undefined>): boolean;
export function buildEInvoicePayload(client: Client, session: Session, invoiceId: string): Promise<{ seller: Record<string, any>; payload: Record<string, any>; invoice: Record<string, any> }>;
export function getEInvoice(client: Client, session: Session, invoiceId: string): Promise<EInvoice | null>;
export function generateEInvoice(client: Client, session: Session, invoiceId: string, options?: Options): Promise<{ einvoice: EInvoice; replayed: boolean }>;
export function cancelEInvoice(client: Client, session: Session, invoiceId: string, input?: { reason?: string; remarks?: string }, options?: Options): Promise<{ einvoice: EInvoice }>;
export function buildEwayBillPayload(movement: Record<string, any>, input?: Record<string, unknown>): Record<string, any>;
export function getEwayBill(client: Client, session: Session, sourceType: string, sourceId: string): Promise<EwayBill | null>;
export function generateEwayBill(client: Client, session: Session, sourceType: string, sourceId: string, input?: Record<string, unknown>, options?: Options): Promise<{ ewayBill: EwayBill; replayed: boolean }>;
export function updateEwayBillVehicle(client: Client, session: Session, ewayBillId: string, input?: Record<string, unknown>, options?: Options): Promise<{ ewayBill: EwayBill }>;
export function cancelEwayBill(client: Client, session: Session, ewayBillId: string, input?: { reason?: string; remarks?: string }, options?: Options): Promise<{ ewayBill: EwayBill }>;
