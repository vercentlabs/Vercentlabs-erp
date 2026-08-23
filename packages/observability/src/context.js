import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const storage = new AsyncLocalStorage();

export function currentContext() {
  return storage.getStore() || {};
}

export function runWithContext(input = {}, work) {
  if (typeof work !== "function") {
    throw new TypeError("runWithContext requires a work function.");
  }

  const parent = currentContext();
  const requestId = input.requestId || parent.requestId || randomUUID();
  const context = Object.freeze({
    ...parent,
    ...input,
    requestId,
    correlationId:
      input.correlationId ||
      parent.correlationId ||
      input.requestId ||
      parent.requestId ||
      requestId,
    traceId: input.traceId || parent.traceId,
    spanId: input.spanId || parent.spanId,
    organizationId: input.organizationId || parent.organizationId,
    userId: input.userId || parent.userId,
  });

  return storage.run(context, work);
}

export function requestIdentifiers(headers) {
  const provided = headers?.get?.("x-request-id")?.trim();
  const correlation = headers?.get?.("x-correlation-id")?.trim();
  const valid = (value) =>
    Boolean(value && /^[A-Za-z0-9._:-]{8,128}$/.test(value));

  const requestId = valid(provided) ? provided : randomUUID();

  return Object.freeze({
    requestId,
    correlationId: valid(correlation) ? correlation : requestId,
  });
}
