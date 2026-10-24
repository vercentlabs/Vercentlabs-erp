// Job work and Form ITC-04 (Procurement report Phase 3).
export type JobWorkLine = { id: string; sequence: number; itemId: string | null; description: string; hsnSacCode: string | null; unit: string | null; quantity: number; unitValue: number;
  value: number; processed: number; returned: number; waste: number; pending: number };
export type JobWork = {
  id: string; number: string; status: "draft" | "sent" | "partly_returned" | "completed" | "cancelled"; statusLabel: string; supplierId: string;
  jobWorker: { name?: string; legalName?: string; gstin?: string | null; stateCode?: string | null }; sentDate: string | null; dueDate: string | null; goodsKind: "inputs" | "capital_goods";
  natureOfJob: string | null; warehouseId: string | null; warehouseName: string | null; purchaseOrderId: string | null; purchaseOrderNumber: string | null; vehicleNumber: string | null;
  notes: string | null; totalValue: number; stockMoved: boolean; overdue: boolean; open?: boolean; lines?: JobWorkLine[];
  returns?: Array<{ id: string; lineId: string; returnDate: string; kind: "processed" | "unprocessed" | "waste"; quantity: number; challanNumber: string | null; challanDate: string | null;
    goodsReceiptId: string | null; goodsReceiptNumber: string | null; notes: string | null }>;
};
export declare const JOB_WORK_GOODS: ReadonlyArray<{ code: string; label: string; years: number }>;
export declare const JOB_WORK_RETURN_KINDS: ReadonlyArray<string>;
export declare function listJobWork(client: any, context: any, filters?: { view?: string; supplierId?: string }): Promise<{ rows: JobWork[]; goods: typeof JOB_WORK_GOODS; canManage: boolean }>;
export declare function getJobWork(client: any, context: any, id: string): Promise<JobWork & { actions: { send: boolean; recordReturn: boolean; cancel: boolean } }>;
export declare function createJobWork(client: any, context: any, input: Record<string, unknown>): Promise<JobWork>;
export declare function sendJobWork(client: any, context: any, id: string, input?: { sentDate?: string }): Promise<JobWork>;
export declare function cancelJobWork(client: any, context: any, id: string): Promise<JobWork>;
export declare function recordJobWorkReturn(client: any, context: any, id: string, input: Record<string, unknown>): Promise<JobWork & { capitalised: number }>;
export declare function exportItc04(client: any, context: any, input: { from?: string; to?: string }): Promise<{ fileName: string; csv: string; counts: { sent: number; back: number } }>;
