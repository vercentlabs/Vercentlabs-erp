import { Badge, StatusBadge } from "@vercentlabs/design-system";

import type { AccountStatus, AccountType } from "./api/accounts-api";

export const TYPE_LABELS: Record<AccountType, string> = { prospect: "Prospect", customer: "Customer", partner: "Partner", other: "Other" };
export const STATUS_LABELS: Record<AccountStatus, string> = { active: "Active", inactive: "Inactive", archived: "Archived" };

const TYPE_TONE: Record<AccountType, "info" | "success" | "brand" | "neutral"> = { prospect: "info", customer: "success", partner: "brand", other: "neutral" };
const STATUS_TONE: Record<AccountStatus, "success" | "warning" | "neutral"> = { active: "success", inactive: "warning", archived: "neutral" };

export const ADDRESS_TYPE_LABELS: Record<string, string> = {
  registered: "Registered", billing: "Billing", shipping: "Shipping", office: "Office / Branch", other: "Other",
};

export function AccountTypeBadge({ type }: { type: AccountType }) {
  return <Badge tone={TYPE_TONE[type]}>{TYPE_LABELS[type]}</Badge>;
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</StatusBadge>;
}

export function locationOf(account: { city: string | null; state: string | null; countryCode: string | null }) {
  return [account.city, account.state, account.countryCode].filter(Boolean).join(", ");
}

// "Customer", "Status", … from the history event codes.
export function humanizeEvent(code: string) {
  return code.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}
