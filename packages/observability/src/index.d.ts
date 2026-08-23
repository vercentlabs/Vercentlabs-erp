export type LogContext = {
  requestId?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  organizationId?: string;
  userId?: string;
  [key: string]: unknown;
};

export function redact<T>(value: T): unknown;
export function currentContext(): LogContext;
export function runWithContext<T>(
  input: LogContext,
  work: () => T,
): T;

export function requestIdentifiers(
  headers: Pick<Headers, "get">,
): Readonly<{
  requestId: string;
  correlationId: string;
}>;

export function createLogger(
  service: string,
  sink?: Pick<Console, "log" | "warn" | "error">,
): Readonly<{
  debug(message: string, fields?: Record<string, unknown>): unknown;
  info(message: string, fields?: Record<string, unknown>): unknown;
  warn(message: string, fields?: Record<string, unknown>): unknown;
  error(message: string, fields?: Record<string, unknown>): unknown;
}>;

export type MetricLabels = Record<string, string | number | boolean | null | undefined>;

export function createMetricRegistry(): Readonly<{
  increment(name: string, value?: number, labels?: MetricLabels): number;
  gauge(name: string, value: number, labels?: MetricLabels): number;
  observe(
    name: string,
    value: number,
    labels?: MetricLabels,
  ): Readonly<{
    name: string;
    labels: MetricLabels;
    count: number;
    sum: number;
    min: number | null;
    max: number | null;
  }>;
  snapshot(): Readonly<{
    counters: readonly Record<string, unknown>[];
    gauges: readonly Record<string, unknown>[];
    histograms: readonly Record<string, unknown>[];
  }>;
  reset(): void;
}>;

export function withSpan<T>(
  name: string,
  attributes: Record<string, unknown> | undefined,
  work: (span: Readonly<Record<string, unknown>>) => Promise<T> | T,
  options?: {
    onEnd?: (span: Readonly<Record<string, unknown>>) => void;
  },
): Promise<T>;

export function normalizeError(
  error: unknown,
): Readonly<{
  name: string;
  message: string;
  code?: unknown;
  stack?: string;
}>;

export function reportError(
  logger: { error(message: string, fields?: Record<string, unknown>): unknown },
  error: unknown,
  fields?: Record<string, unknown>,
): ReturnType<typeof normalizeError>;
