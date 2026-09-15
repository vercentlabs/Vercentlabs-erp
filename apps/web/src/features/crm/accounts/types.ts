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
