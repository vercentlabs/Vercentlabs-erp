import { randomUUID } from "node:crypto";

import { currentContext, runWithContext } from "./context.js";

export async function withSpan(name, attributes, work, options = {}) {
  if (!name || typeof name !== "string") {
    throw new TypeError("Span name is required.");
  }
  if (typeof work !== "function") {
    throw new TypeError("withSpan requires a work function.");
  }

  const parent = currentContext();
  const traceId = parent.traceId || randomUUID();
  const spanId = randomUUID();
  const startedAt = Date.now();

  return runWithContext(
    {
      ...parent,
      traceId,
      spanId,
    },
    async () => {
      try {
        const value = await work(
          Object.freeze({
            name,
            traceId,
            spanId,
            parentSpanId: parent.spanId,
            attributes: Object.freeze({ ...(attributes || {}) }),
          }),
        );

        options.onEnd?.(
          Object.freeze({
            name,
            traceId,
            spanId,
            parentSpanId: parent.spanId,
            attributes: Object.freeze({ ...(attributes || {}) }),
            status: "ok",
            durationMilliseconds: Date.now() - startedAt,
          }),
        );

        return value;
      } catch (error) {
        options.onEnd?.(
          Object.freeze({
            name,
            traceId,
            spanId,
            parentSpanId: parent.spanId,
            attributes: Object.freeze({ ...(attributes || {}) }),
            status: "error",
            durationMilliseconds: Date.now() - startedAt,
            errorName: error?.name || "Error",
          }),
        );
        throw error;
      }
    },
  );
}
