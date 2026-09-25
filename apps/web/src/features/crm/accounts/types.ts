// Shape returned by services/api's account-operations.js (getCrmAccountForCaller
// / listCrmAccounts) — camelized tenant.business_parties columns plus the
// primary-address projection and relationship counts. Left loose for fields
// this pass hasn't independently verified against projectAccountForContext.
export type Account = {
  id: string;
  code: string;
  companyId: string | null;
  partyType: "customer" | "both" | "prospect";
  displayName: string;
  legalName: string | null;
  industry: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  msmeNumber: string | null;
  currencyCode: string | null;
  status: "active" | "inactive";
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  companyScopeName: string | null;
  relationships?: { contacts: number; opportunities: number };
  createdAt: string;
  updatedAt: string;
};

export type AccountListFilters = {
  search?: string;
  status?: "active" | "inactive" | "all";
  industry?: string;
  country?: string;
  limit?: number;
  offset?: number;
};

export type AccountListResponse = {
  rows: Account[];
  total: number;
  limit: number;
  offset: number;
  filters: { industries: string[]; countries: string[] };
};

// account-intelligence.js (getAccountHierarchy/previewAccountMergeForCaller)
// returns RAW tenant.business_parties rows — this file is the one place in
// the CRM backend that does not run camelizeRow — so these types are
// deliberately snake_case, not a typo relative to the camelCase convention
// used everywhere else in this codebase.
export type AccountHierarchyNode = {
  id: string;
  parent_party_id: string | null;
  display_name: string;
  legal_name: string | null;
  party_type: string;
  status: string;
  depth: number;
};

export type AccountHierarchyEvent = {
  id: string;
  action: "parent_set" | "parent_cleared";
  previous_parent_name: string | null;
  new_parent_name: string | null;
  reason: string | null;
  changed_by_name: string | null;
  changed_at: string;
};

export type AccountHierarchy = {
  account: Record<string, unknown> & { id: string; display_name: string; parent_party_id: string | null };
  ancestors: AccountHierarchyNode[];
  descendants: AccountHierarchyNode[];
  history: AccountHierarchyEvent[];
  metrics: { ancestorCount: number; descendantCount: number; hierarchyDepth: number };
};

export type AccountDuplicateMatch = {
  id: string;
  code: string;
  display_name: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  match_score: number;
  matched_signals: string[];
};

export type AccountMergePreview = {
  source: Record<string, unknown> & { id: string };
  survivor: Record<string, unknown> & { id: string };
  impact: { tableName: string; columnName: string; count: number }[];
  fieldComparison: Record<string, { source: unknown; survivor: unknown }>;
};

export type AccountPlan = {
  id: string;
  companyId: string | null;
  partyId: string;
  ownerUserId: string | null;
  executiveSponsorUserId: string | null;
  accountTier: string | null;
  lifecycleStage: string | null;
  // jsonb columns — see AccountPlanPanel.tsx's arrayToLines/successPlanToText
  // for why these are arrays/an object here, not strings.
  objectives: string[];
  risks: string[];
  whiteSpace: string[];
  successPlan: Record<string, unknown>;
  renewalDate: string | null;
  annualRevenue: number | string | null;
  potentialRevenue: number | string | null;
  // numeric(5,2) — same string-at-runtime caveat as annualRevenue/potentialRevenue.
  healthScore: number | string | null;
  healthStatus: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type AccountStakeholder = {
  id: string;
  companyId: string | null;
  accountPlanId: string;
  contactId: string | null;
  name: string;
  title: string | null;
  stakeholderRole: string | null;
  influenceLevel: string | null;
  sentiment: string | null;
  relationshipOwnerUserId: string | null;
  engagementScore: number | null;
  notes: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };

// getCustomer360ForCaller (account-intelligence.js) — RAW snake_case rows
// for `account`/`contacts`/`timeline`, same convention as AccountHierarchy
// above, since this reuses the same un-camelized account-intelligence.js
// read paths. sensitiveDataRestricted appears on `account`/each contact only
// when the caller lacks crm.accounts.view_sensitive / crm.contacts.view_sensitive.
export type Customer360TimelineEntry = {
  entry_type: "activity" | "communication" | "opportunity" | "quotation" | "sales_order" | "invoice" | "receipt" | "support";
  entry_id: string;
  occurred_at: string;
  title: string | null;
  status: string | null;
  amount: number | string | null;
  currency_code: string | null;
  details: Record<string, unknown>;
};

export type Customer360 = {
  account: Record<string, unknown> & { id: string; display_name: string; sensitiveDataRestricted?: boolean };
  hierarchy: AccountHierarchy;
  contacts: (Record<string, unknown> & { id: string; first_name: string; sensitiveDataRestricted?: boolean })[];
  metrics: {
    opportunities: number;
    quotations: number;
    orders: number;
    invoices: number;
    outstanding: number | string;
    open_service_cases: number;
  };
  timeline: Customer360TimelineEntry[];
  sourceCoverage: { crm: boolean; quotations: boolean; orders: boolean; invoices: boolean; support: boolean; supportMode: string };
};

