export type LogContext = { requestId?: string; correlationId?: string; organizationId?: string; userId?: string };
export function redact<T>(value: T): unknown;
export function currentContext(): LogContext;
export function runWithContext<T>(input: LogContext, work: () => T): T;
export function requestIdentifiers(headers: Pick<Headers, "get">): Readonly<{ requestId: string; correlationId: string }>;
export function createLogger(service: string, sink?: Pick<Console, "log" | "warn" | "error">): Readonly<{ debug(message: string, fields?: Record<string, unknown>): unknown; info(message: string, fields?: Record<string, unknown>): unknown; warn(message: string, fields?: Record<string, unknown>): unknown; error(message: string, fields?: Record<string, unknown>): unknown }>;
