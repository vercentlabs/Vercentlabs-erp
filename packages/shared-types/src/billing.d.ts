export type BillingPlanCode =
  "founder-preview" | "launch" | "growth" | "scale" | "enterprise";

export type BillingPeriod = "monthly" | "yearly" | "custom";

export type BillingSubscriptionStatus =
  | "trialing"
  | "checkout_pending"
  | "authenticated"
  | "active"
  | "past_due"
  | "halted"
  | "cancelled"
  | "completed"
  | "expired"
  | "internal";

export type BillingUsageMetric =
  | "api_requests_monthly"
  | "automation_actions_monthly"
  | "outbound_messages_monthly"
  | "imports_rows_monthly"
  | "storage_bytes";

export interface BillingPlanLimits {
  companies: number;
  branches: number;
  storage_gb: number;
  api_requests_monthly: number;
  automation_actions_monthly: number;
  outbound_messages_monthly: number;
  imports_rows_monthly: number;
}

export interface BillingPlanPrice {
  id: string;
  planCode: BillingPlanCode;
  planName: string;
  description: string;
  billingPeriod: BillingPeriod;
  currency: string;
  amountPaise: number;
  onboardingFeePaise: number;
  trialDays: number;
  features: string[];
  limits: BillingPlanLimits;
  modules: string[];
  providerPlanReady: boolean;
}

export interface BillingSummary {
  status: BillingSubscriptionStatus;
  planCode: BillingPlanCode;
  planName: string;
  billingPeriod: BillingPeriod;
  currentPeriodEndsAt: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  cancelAtCycleEnd: boolean;
  providerSubscriptionId: string | null;
  limits: BillingPlanLimits;
  modules: string[];
  usage: Record<string, number>;
  writeAccess: boolean;
  enforcementMode: "observe" | "enforce";
}

export const BILLING_PLAN_CODES: readonly BillingPlanCode[];
export const BILLING_PERIODS: readonly BillingPeriod[];
export const BILLING_SUBSCRIPTION_STATUSES: readonly BillingSubscriptionStatus[];
export const BILLING_USAGE_METRICS: readonly BillingUsageMetric[];
