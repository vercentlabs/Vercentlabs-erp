import type { PoolClient } from "pg";

type Client = Pick<PoolClient, "query">;
export class BillingServiceError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code?: string);
}
export const MAX_SEATED_USERS: number;
export const SEAT_OVERAGE_GRACE_DAYS: number;
export type BillingContext = { organizationId: string; userId: string; email?: string };
export type BillingProvider = Record<string, any>;
export type SeatStatus = {
  planCode: string | null;
  planName: string | null;
  pricingModel: string | null;
  includedUsers: number | null;
  paidSeats: number;
  pendingPaidSeats: number | null;
  capacity: number | null;
  activeMembers: number;
  pendingInvitations: number;
  used: number;
  available: number | null;
  overCapacity: boolean;
  perUserPricePaise: number | null;
  seatOverageSince: string | null;
  wouldBlock?: boolean;
};
export function calculateSeatCharge(input: { includedUsers: number; perUserPaise: number; totalUsers: number }): { totalUsers: number; includedUsers: number; billableSeats: number; monthlyPaise: number };
export function getSeatStatus(client: Client, organizationId: string, options?: { excludeInvitationId?: string | null }): Promise<SeatStatus>;
export function assertSeatAvailable(client: Client, organizationId: string, options?: { additional?: number; excludeInvitationId?: string | null; env?: Record<string, string | undefined> }): Promise<SeatStatus | null>;
export function withSeatLock<T>(client: Client, organizationId: string, work: () => Promise<T>): Promise<T>;
export function reconcileSeatOverage(client: Client, organizationId: string): Promise<SeatStatus>;
export function listPlanCatalogue(client: Client, organizationId?: string | null, env?: Record<string, string | undefined>): Promise<Array<Record<string, any>>>;
export function getBillingOverview(client: Client, organizationId: string, env?: Record<string, string | undefined>): Promise<Record<string, any>>;
export function saveBillingProfile(client: Client, ctx: BillingContext, input: Record<string, unknown>): Promise<Record<string, any>>;
export function startSeatCheckout(client: Client, ctx: BillingContext, input: { planPriceId: string; users: number }, provider: BillingProvider, env?: Record<string, string | undefined>): Promise<Record<string, any>>;
export function confirmSeatCheckout(client: Client, ctx: BillingContext, input: Record<string, any>, provider: BillingProvider): Promise<Record<string, any>>;
export function changeSubscriptionSeats(client: Client, ctx: BillingContext, input: { users: number }, provider: BillingProvider): Promise<Record<string, any>>;
export function revertToFree(client: Client, organizationId: string, reason: string, actorUserId?: string | null): Promise<void>;
export function cancelPaidSubscription(client: Client, ctx: BillingContext, input: { cancelAtCycleEnd?: boolean }, provider: BillingProvider): Promise<Record<string, any>>;
export function handleBillingWebhook(client: Client, input: { rawBody: string; signature: string | null; eventId?: string | null }, provider: BillingProvider): Promise<{ duplicate: boolean; status: string }>;
export function retryBillingWebhooks(client: Client, options?: { limit?: number }): Promise<{ processed: number; failed: number }>;
export function syncSubscriptionFromProvider(client: Client, ctx: BillingContext, provider: BillingProvider): Promise<{ synced: boolean; reason?: string; providerStatus?: string; result?: string }>;
