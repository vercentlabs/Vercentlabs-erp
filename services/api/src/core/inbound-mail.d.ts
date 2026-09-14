export declare const PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT: string;
export declare class InboundMailError extends Error {
  status: number;
  code?: string;
}
export declare function verifyInboundMailSignature(rawBody: Uint8Array, signatureValue: string | null, env?: any): void;
export declare function recordInboundMailEvent(client: any, input: any): Promise<{ id: string; replayed: boolean }>;
