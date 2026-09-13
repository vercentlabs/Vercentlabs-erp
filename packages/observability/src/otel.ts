/**
 * A minimal, dependency-free tracing abstraction shaped after the
 * OpenTelemetry API so a real `@opentelemetry/api` `Tracer` can be swapped in
 * later without touching call sites. No OTel SDK is wired up in this
 * foundation prompt; `getTracer()` returns a no-op implementation.
 */
export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: unknown): void;
  end(): void;
}

export interface Tracer {
  startSpan(name: string): Span;
}

class NoopSpan implements Span {
  setAttribute(): void {
    /* no-op until an OTel exporter is configured */
  }

  recordException(): void {
    /* no-op until an OTel exporter is configured */
  }

  end(): void {
    /* no-op until an OTel exporter is configured */
  }
}

class NoopTracer implements Tracer {
  startSpan(): Span {
    return new NoopSpan();
  }
}

let activeTracer: Tracer = new NoopTracer();

export function getTracer(): Tracer {
  return activeTracer;
}

/** Allows a future OTel SDK bootstrap to install a real tracer at startup. */
export function setTracer(tracer: Tracer): void {
  activeTracer = tracer;
}

export async function withSpan<T>(name: string, fn: (span: Span) => Promise<T> | T): Promise<T> {
  const span = getTracer().startSpan(name);
  try {
    return await fn(span);
  } catch (error) {
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
