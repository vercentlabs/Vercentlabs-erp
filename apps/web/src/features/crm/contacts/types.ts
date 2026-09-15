export type Contact = {
  id: string;
  accountId: string | null;
  firstName: string;
  lastName: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  preferredLanguage: string | null;
  timezone: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type ContactListFilters = {
  search?: string;
  accountId?: string;
  status?: "active" | "inactive" | "all";
  limit?: number;
  offset?: number;
};

// previewContactMergeForCaller (account-intelligence.js) does not run
// camelizeRow — same non-standard raw-row shape as the Account merge
// preview (see accounts/types.ts's own comment on this).
export type ContactDuplicateMatch = {
  id: string;
  party_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  designation: string | null;
  account_name: string | null;
  match_score: number;
  matched_signals: string[];
};

export type ContactMergePreview = {
  source: Record<string, unknown> & { id: string };
  survivor: Record<string, unknown> & { id: string };
  impact: { tableName: string; columnName: string; count: number }[];
  fieldComparison: Record<string, { source: unknown; survivor: unknown }>;
};

export type ContactListResponse = { rows: Contact[]; total: number; limit: number; offset: number };
