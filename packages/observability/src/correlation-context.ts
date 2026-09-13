import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationContext {
  correlationId: string;
  causationId?: string;
  organizationId?: string;
  actorId?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Runs `fn` with `context` bound for the duration of the async call chain. */
export function runWithCorrelationContext<T>(context: CorrelationContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
