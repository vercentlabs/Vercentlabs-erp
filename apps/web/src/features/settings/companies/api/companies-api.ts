"use client";

export class CompaniesApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new CompaniesApiError(payload.message || "The request could not be completed.", response.status);
  }
  return payload;
}

export type CompanyRow = {
  id: string;
  name: string;
  legal_name: string;
  code: string;
  country_code: string;
  base_currency: string;
  tax_id: string | null;
  is_primary: boolean;
  status: "active" | "inactive";
  created_at: string;
};

export async function listCompanies(): Promise<{ companies: CompanyRow[] }> {
  const response = await fetch("/api/settings/companies");
  return parseResponse(response);
}

export async function createCompany(input: {
  name: string;
  legalName: string;
  code: string;
  countryCode: string;
  baseCurrency: string;
  taxId?: string;
  isPrimary?: boolean;
}): Promise<{ company: CompanyRow }> {
  const response = await fetch("/api/settings/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateCompany(
  id: string,
  updates: { name?: string; legalName?: string; taxId?: string | null; status?: "active" | "inactive" },
): Promise<{ company: CompanyRow }> {
  const response = await fetch(`/api/settings/companies/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return parseResponse(response);
}
