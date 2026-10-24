// The payment advice sent to the supplier (Procurement report Phase 2).
type Row = Record<string, any>;
export declare function paymentAdviceRecipient(client: any, organizationId: string, supplierId: string): Promise<{ email: string | null; phone: string | null; name: string | null }>;
export declare function paymentAdviceText(detail: Row, company: string | null): string;
export declare function sendPaymentAdvice(client: any, context: any, detail: Row, input?: { to?: string; cc?: string; auto?: boolean }, attachment?: { fileName: string; content: Uint8Array | Buffer } | null,
  env?: Record<string, string | undefined>): Promise<{ sent: boolean; to: string | null; reason: string | null }>;
export declare function paymentAdviceSends(client: any, context: any, detail: Row): Promise<{ sends: Row[]; recipient: { email: string | null; name: string | null }; whatsapp: string }>;
export declare function paymentAdviceAuto(client: any, organizationId: string): Promise<boolean>;
