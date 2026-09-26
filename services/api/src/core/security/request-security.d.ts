export declare class SecurityError extends Error {
  status: number;
  code?: string;
}
export declare function sha256(value: string): string;
export declare function verifiedCaptureProxyFingerprint(request: Request, rawBody: string, env?: any): string | null;
export declare function directCaptureFingerprint(request: Request, env?: any): string;
export declare function canonicalAppOrigin(env?: any): string;
export declare function clientIp(request: Request, env?: any): string;
export declare function assertSameOrigin(request: Request, env?: any): void;
export declare function assertSameOriginOrMobile(request: Request, env?: any): void;
export declare function readRequestBytes(request: Request, maximumBytes: number): Promise<Uint8Array>;
export declare function enforceRateLimit(client: any, key: string, maximum: number, windowSeconds: number): Promise<void>;
export declare function audit(client: any, input: any): Promise<void>;
export declare function recordLoginEvent(client: any, input: any): Promise<void>;
