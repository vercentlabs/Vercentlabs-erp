export type WorkerConfig = {
  target: "worker";
  production: boolean;
  database: Record<string, unknown>;
  appUrl: string;
  allowedOrigins: string[];
  worker: {
    enabled: boolean;
    concurrency: number;
    pollIntervalMilliseconds: number;
    leaseMilliseconds: number;
    batchSize: number;
    schedulerTickMilliseconds: number;
    webhookTimeoutMilliseconds: number;
    allowPrivateWebhookTargets: boolean;
  };
};

export declare function getWorkerConfig(environment?: NodeJS.ProcessEnv): WorkerConfig;
export declare function getPool(): Promise<any>;
export declare function closePool(): Promise<void>;
export declare function listActiveOrganizationIds(pool: any): Promise<string[]>;
export declare function withTenantClient<T>(pool: any, organizationId: string, work: (client: any) => Promise<T>): Promise<T>;

export declare class QueueError extends Error {}
export declare function enqueueJob(client: any, organizationId: string, input: Record<string, unknown>): Promise<{ job: Record<string, unknown>; deduped: boolean }>;
export declare function claimJobs(client: any, organizationId: string, options: { workerId: string; leaseMilliseconds: number; batchSize?: number }): Promise<Array<Record<string, unknown>>>;
export declare function completeJob(client: any, jobId: string, workerId: string): Promise<Record<string, unknown> | null>;
export declare function failJob(client: any, jobId: string, workerId: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;

export declare const DEFAULT_MAX_OUTBOX_ATTEMPTS: number;
export declare function claimOutboxEvents(client: any, organizationId: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
export declare function completeOutboxEvent(client: any, id: string, workerId: string, options?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
export declare function failOutboxEvent(client: any, id: string, workerId: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;

export declare class HandlerValidationError extends Error {}
export declare function registerJobHandler(jobType: string, definition: Record<string, unknown>): void;
export declare function getJobHandler(jobType: string): Record<string, unknown> | null;
export declare function listRegisteredJobTypes(): string[];
export declare function validatePayload(definition: Record<string, unknown>, payload: unknown): unknown;
export declare function _resetRegistryForTests(): void;

export declare function internalJobBackoff(attempt: number): number;
export declare function webhookBackoff(attempt: number): number;
export declare function boundedRetryAfterMilliseconds(retryAfterSeconds: number, maxMilliseconds?: number): number | null;

export declare class SsrfError extends Error {}
export declare function isBlockedAddress(address: string, options?: { allowPrivate?: boolean }): boolean;
export declare function validateWebhookUrl(rawUrl: string): URL;
export declare function resolveSafeAddress(hostname: string, options?: { allowPrivate?: boolean }): Promise<{ address: string; family: number }>;

export declare class WebhookDeliveryError extends Error {
  retryable: boolean;
}
export declare function deliverWebhook(endpointUrl: string, options: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function findMatchingSubscriptions(client: any, organizationId: string, eventType: string): Promise<Array<Record<string, unknown>>>;
export declare function deliverOutboxEvent(subscriptions: Array<Record<string, unknown>>, event: Record<string, unknown>, config: Record<string, unknown>): Promise<Record<string, unknown>>;

export declare function detectOverdueActivitiesHandler(client: any, context: Record<string, unknown>, payload: unknown): Promise<{ scanned: number; fired: number }>;
export declare const OVERDUE_ACTIVITY_JOB_TYPE: string;
export declare const overdueActivityPayloadSchema: unknown;

export type SystemContext = {
  organizationId: string;
  userId: null;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  allowAllCompanies: boolean;
  permissions: string[];
  roleSlugs: string[];
};
export declare function buildSystemContext(organizationId: string, options?: { activeCompanyId?: string | null; activeBranchId?: string | null }): SystemContext;
export declare const SYSTEM_ACTOR_ROLE_SLUG: string;

export declare function runSchedulerTick(pool: any, config: WorkerConfig): Promise<{ organizations: number; enqueued: number; deduped: number }>;

export type Worker = {
  workerId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
};
export declare function createWorker(config: WorkerConfig, options?: { workerId?: string }): Worker;
export declare function generateWorkerId(): string;
export declare function registerBuiltinHandlers(): void;
