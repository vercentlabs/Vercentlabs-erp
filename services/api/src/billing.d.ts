export class BillingDomainError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export const PROVIDER_STATUS_MAP: Readonly<Record<string, string>>;
export function mapProviderSubscriptionStatus(status: unknown): string;
export function buildRazorpayPlanPayload(
  price: Record<string, unknown>,
): Record<string, unknown>;
export function buildRazorpaySubscriptionPayload(
  input: Record<string, unknown>,
): Record<string, unknown>;
export function calculatePlanEconomics(input: {
  amountPaise: number;
  estimatedDirectCostPaise: number;
  gatewayReservePercent?: number;
}): {
  gatewayReservePaise: number;
  contributionPaise: number;
  grossMarginPercent: number;
};
export function assertPlanEconomics(input: {
  amountPaise: number;
  estimatedDirectCostPaise: number;
  gatewayReservePercent?: number;
  minimumMarginPercent?: number;
}): {
  gatewayReservePaise: number;
  contributionPaise: number;
  grossMarginPercent: number;
};
export function hasWriteAccess(
  subscription: Record<string, unknown> | null,
  now?: Date,
): boolean;
export function shouldApplyProviderEvent(
  currentEventAt: string | Date | null,
  incomingEventAt: string | Date | null,
): boolean;
