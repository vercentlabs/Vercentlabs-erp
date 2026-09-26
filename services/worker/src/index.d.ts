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
    billingMaintenanceEnabled: boolean;
    billingMaintenanceIntervalMilliseconds: number;
    billingBatchSize: number;
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


export declare class HandlerValidationError extends Error {}
export declare function registerJobHandler(jobType: string, definition: Record<string, unknown>): void;
export declare function getJobHandler(jobType: string): Record<string, unknown> | null;
export declare function listRegisteredJobTypes(): string[];
export declare function validatePayload(definition: Record<string, unknown>, payload: unknown): unknown;
export declare function _resetRegistryForTests(): void;

export declare function internalJobBackoff(attempt: number): number;
export declare function webhookBackoff(attempt: number): number;
export declare function boundedRetryAfterMilliseconds(retryAfterSeconds: number, maxMilliseconds?: number): number | null;

export declare function dispatchOrganizationEvents(pool: any, organizationId: string, options?: { limit?: number }): Promise<{ dispatched: number }>;
export declare function processWebhookDelivery(pool: any, workerId: string, config: any, organizationId: string, claimed: Record<string, any>, options?: { deliver?: (...args: any[]) => Promise<any>; env?: Record<string, string | undefined> }): Promise<string | null>;
export declare function processOrganizationWorkflows(pool: any, organizationId: string): Promise<{ runs: number }>;
export declare function processOrganizationWebhooks(pool: any, workerId: string, config: any, organizationId: string, options?: { deliver?: (...args: any[]) => Promise<any>; env?: Record<string, string | undefined> }): Promise<{ dispatched: number; deliveries: number }>;

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
export declare function runBillingMaintenanceTick(pool: any, config: WorkerConfig, options: { workerId: string; provider?: any; steps?: string[] | null }): Promise<Record<string, any>>;
export declare function createBillingMaintenanceLoop(getPool: () => Promise<any>, config: WorkerConfig, options: { workerId: string; provider?: any }): { start(): void; stop(): Promise<void> };
