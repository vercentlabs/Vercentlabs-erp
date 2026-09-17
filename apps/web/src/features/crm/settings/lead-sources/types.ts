// tenant.crm_lead_sources rows via the dedicated lead-source-operations.js
// module — NOT the generic /api/crm/[resource] boundary, which redirects
// "sources" mutations here (CRM_LEAD_SOURCE_API_MOVED).
export type LeadSourceChannel =
  | "website"
  | "referral"
  | "partner"
  | "event"
  | "advertising"
  | "social"
  | "email"
  | "phone"
  | "walk_in"
  | "import"
  | "other";

export const LEAD_SOURCE_CHANNELS: LeadSourceChannel[] = [
  "website",
  "referral",
  "partner",
  "event",
  "advertising",
  "social",
  "email",
  "phone",
  "walk_in",
  "import",
  "other",
];

export type LeadSource = {
  id: string;
  name: string;
  description: string | null;
  channel: LeadSourceChannel | null;
  sortOrder: number | null;
  isDefault: boolean;
  status: "active" | "inactive";
  leadCount: number;
  createdAt: string;
  updatedAt: string;
};

export type LeadSourceListResponse = { rows: LeadSource[]; total: number; limit: number; offset: number };
