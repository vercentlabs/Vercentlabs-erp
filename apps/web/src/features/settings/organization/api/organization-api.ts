"use client";

export class OrganizationApiError extends Error {
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
    throw new OrganizationApiError(payload.message || "The request could not be completed.", response.status);
  }
  return payload;
}

export type OrganizationProfile = {
  id: string;
  name: string;
  slug: string;
  country_code: string;
  timezone: string;
  base_currency: string;
  fiscal_year_start_month: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function getOrganizationProfile(): Promise<{ profile: OrganizationProfile }> {
  const response = await fetch("/api/settings/organization/profile");
  return parseResponse(response);
}

export async function updateOrganizationProfile(updates: {
  name?: string;
  timezone?: string;
  fiscalYearStartMonth?: number;
}): Promise<{ profile: OrganizationProfile }> {
  const response = await fetch("/api/settings/organization/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return parseResponse(response);
}
