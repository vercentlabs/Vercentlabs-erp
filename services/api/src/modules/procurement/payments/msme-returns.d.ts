// MSME-1 and the year-end figures (Procurement report Phase 3).
export type Msme1Row = { supplierId: string; supplierName: string; pan: string | null; udyam: string | null; classification: string | null; billId: string; billNumber: string;
  supplierInvoice: string | null; acceptanceDate: string; dueDate: string; daysOverdue: number; amount: string; currencyCode: string };
export declare function msme1Return(client: any, context: any, input: { half?: string }): Promise<{ period: { half: string; from: string; to: string }; asOf: string; rows: Msme1Row[];
  total: string; csv: string; fileName: string }>;
export declare function msmeYearEnd(client: any, context: any, input: { year?: number | string; bankRate?: string }): Promise<{ asOf: string; bankRate: string; interestRate: string;
  owed: string; pastDue: string; interest: string; suppliers: Array<{ supplierId: string; supplierName: string; udyam: string | null; owed: string; pastDue: string; interest: string }> }>;
