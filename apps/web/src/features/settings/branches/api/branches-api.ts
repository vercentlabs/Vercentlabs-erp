"use client";

export class BranchesApiError extends Error {
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
    throw new BranchesApiError(payload.message || "The request could not be completed.", response.status);
  }
  return payload;
}

export type BranchRow = {
  id: string;
  company_id: string;
  name: string;
  code: string;
  timezone: string;
  is_primary: boolean;
  status: "active" | "inactive";
  created_at: string;
};

export async function listBranches(): Promise<{ branches: BranchRow[] }> {
  const response = await fetch("/api/settings/branches");
  return parseResponse(response);
}

export async function createBranch(input: { name: string; code: string; timezone: string; companyId: string; isPrimary?: boolean }): Promise<{ branch: BranchRow }> {
  const response = await fetch("/api/settings/branches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateBranch(id: string, updates: { name?: string; timezone?: string; status?: "active" | "inactive" }): Promise<{ branch: BranchRow }> {
  const response = await fetch(`/api/settings/branches/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return parseResponse(response);
}
