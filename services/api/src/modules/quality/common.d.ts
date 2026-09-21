export declare class QualityError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code?: string);
}
type C = Record<string, unknown>;
export declare const uuid: (value: unknown, label: string) => string;
export declare const uuidOrNull: (value: unknown, label: string) => string | null;
export declare const text: (value: unknown, max?: number) => string;
export declare const textOrNull: (value: unknown, max?: number) => string | null;
export declare const has: (c: C, p: string) => boolean;
export declare const hasAny: (c: C, list: string[]) => boolean;
export declare const need: (c: C, p: string) => void;
export declare const needAny: (c: C, list: string[]) => void;
export declare const positive: (value: unknown, label: string) => number;
export declare const nonNegative: (value: unknown, label: string, fallback?: number) => number;
export declare const dateOrNull: (value: unknown, label: string) => string | null;
export declare const dateRequired: (value: unknown, label: string) => string;
export declare const oneOf: <T extends string>(value: string, allowed: T[], label: string) => T;
export declare const today: () => string;
export declare const round2: (n: unknown) => number;
// Exact shape (not just Record<string, unknown>) so this satisfies the stricter QualityContext type
// this folder's original index.d.ts declares for the one legacy function reused as-is (releaseQualityHold).
export declare function qualityContext(session: Record<string, unknown>): {
  organizationId: string;
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roleSlugs: readonly string[];
};
export declare function recordEvent(client: unknown, c: C, aggregateType: string, aggregateId: string, eventType: string, payload?: Record<string, unknown>): Promise<void>;
export declare const ymd: (v: unknown) => unknown;
export declare function qx(client: unknown, sql: string, params: unknown[]): Promise<any>;
export declare function seq(thunks: Array<() => Promise<any>>): Promise<any[]>;
