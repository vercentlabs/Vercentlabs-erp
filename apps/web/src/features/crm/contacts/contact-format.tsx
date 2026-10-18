import { Badge, StatusBadge } from "@vercentlabs/design-system";

import { formatPhone } from "@vercentlabs/shared-types";
import type { Contact, ContactStatus } from "./api/contacts-api";

export { ErrorBanner } from "@/features/crm/accounts/account-format";
export { LIVE_LEAD_QUERY as LIVE_CONTACT_QUERY } from "@/features/crm/leads/live-query";

export const STATUS_LABELS: Record<ContactStatus, string> = { active: "Active", inactive: "Inactive", archived: "Archived" };
const STATUS_TONE: Record<ContactStatus, "success" | "warning" | "neutral"> = { active: "success", inactive: "warning", archived: "neutral" };

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</StatusBadge>;
}

export function RoleBadge({ label }: { label: string | null }) {
  if (!label) return null;
  return <Badge tone="brand">{label}</Badge>;
}

// "Procurement Head · ABC Manufacturing"
export function positionOf(contact: Pick<Contact, "jobTitle" | "accountName">) {
  return [contact.jobTitle, contact.accountName].filter(Boolean).join(" · ");
}

// The best number to reach someone on, respecting their preference.
export function bestPhone(contact: Pick<Contact, "mobile" | "phone" | "alternatePhone" | "preferredContactMethod">) {
  // Shown grouped the international way (+91 98765 43210); dial links use the stored E.164 number.
  if (contact.preferredContactMethod === "phone" && contact.phone) return formatPhone(contact.phone);
  const best = contact.mobile || contact.phone || contact.alternatePhone || null;
  return best ? formatPhone(best) : null;
}
