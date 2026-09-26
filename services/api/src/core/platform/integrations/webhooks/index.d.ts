type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string };
type Env = Record<string, string | undefined>;

export function webhookBackoff(attempt: number): number;
export function boundedRetryAfterMilliseconds(retryAfterSeconds: number, maxMilliseconds?: number): number | null;
export class SsrfError extends Error {}
export function isBlockedAddress(address: string, options?: { allowPrivate?: boolean }): boolean;
export function validateWebhookUrl(rawUrl: string, options?: { allowPrivate?: boolean }): URL;
export function resolveSafeAddress(hostname: string, options?: { allowPrivate?: boolean }): Promise<{ address: string; family: number }>;
export class WebhookDeliveryError extends Error {
  retryable: boolean;
  code: string;
}
export function deliverWebhook(
  endpointUrl: string,
  options: { body?: string; payload?: unknown; headers?: Record<string, string>; timeoutMilliseconds: number; allowPrivateTargets?: boolean; deliveryId?: string },
): Promise<{ outcome: "success" | "retryable" | "terminal"; statusCode: number; durationMilliseconds: number; bodyPreview: string; retryAfterMilliseconds: number | null }>;

export const WEBHOOK_MAX_ATTEMPTS: number;
export class WebhookError extends Error {
  status: number;
  code: string;
}
export function createWebhookSecret(): string;
export function signWebhookPayload(secret: string, input: { deliveryId: string; timestamp: string; body: string }): string;
export function verifyOutboundWebhookSignature(secret: string, input: { deliveryId: string; timestamp: string; body: string; signatureHeader: string }): boolean;
export type WebhookSubscriptionSummary = {
  id: string;
  name: string;
  endpointUrl: string;
  eventTypes: string[];
  unrecognizedEventTypes: string[];
  status: "active" | "disabled";
  signed: boolean;
  secretVersion: number;
  secretRotatedAt: string | null;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  health: "disabled" | "failing" | "degraded" | "healthy" | "no_deliveries";
  pendingDeliveries: number;
  deadDeliveries: number;
};
export type WebhookDeliverySummary = {
  id: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  eventLabel: string;
  status: "pending" | "processing" | "retry" | "delivered" | "dead";
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  lastStatusCode: number | null;
  deliveredAt: string | null;
  redeliveryCount: number;
  createdAt: string;
};
export function listWebhookSubscriptions(client: Client, organizationId: string): Promise<WebhookSubscriptionSummary[]>;
export function createWebhookSubscription(client: Client, session: Session, input: { name: string; endpointUrl: string; eventTypes: string[] }, env?: Env): Promise<{ subscription: WebhookSubscriptionSummary; signingSecret: string }>;
export function updateWebhookSubscription(client: Client, session: Session, id: string, input: { name?: string; endpointUrl?: string; eventTypes?: string[]; status?: "active" | "disabled" }, env?: Env): Promise<WebhookSubscriptionSummary>;
export function rotateWebhookSecret(client: Client, session: Session, id: string, env?: Env): Promise<{ subscription: WebhookSubscriptionSummary; signingSecret: string }>;
export function listWebhookDeliveries(client: Client, organizationId: string, options?: { subscriptionId?: string | null; status?: string | null; limit?: number }): Promise<WebhookDeliverySummary[]>;
export function redeliverWebhookDelivery(client: Client, session: Session, deliveryId: string): Promise<{ id: string; status: "pending" }>;
export function fanOutWebhookDeliveries(client: Client, event: Record<string, any>): Promise<void>;
export function claimWebhookDeliveries(client: Client, organizationId: string, options: { workerId: string; leaseMilliseconds: number; batchSize?: number }): Promise<Array<Record<string, any>>>;
export function buildWebhookRequest(claimed: Record<string, any>, options?: { env?: Env; now?: Date }): { url: string; body: string; headers: Record<string, string>; deliveryId: string };
export function completeWebhookDelivery(client: Client, deliveryId: string, workerId: string, result?: { statusCode?: number | null; responseSummary?: string | null }): Promise<boolean>;
export function failWebhookDelivery(
  client: Client,
  deliveryId: string,
  workerId: string,
  input: { error: string; statusCode?: number | null; retryable?: boolean; backoffMilliseconds?: number; maxAttempts?: number },
): Promise<string | null>;
