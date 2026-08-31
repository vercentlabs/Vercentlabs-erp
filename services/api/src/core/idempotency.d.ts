export declare class IdempotencyError extends Error {
  status: number;
  code: string;
}
export declare function canonicalPayloadJson(payload: unknown): string;
export declare function requestPayloadHash(payload: unknown): string;
export declare function beginIdempotentOperation(client: any, context: any, options: {operation:string;key?:unknown;payload?:unknown;required?:boolean}): Promise<any>;
export declare function completeIdempotentOperation(client: any, context: any, token: any, options?: {response?:unknown;aggregateType?:string|null;aggregateId?:string|null}): Promise<any>;
