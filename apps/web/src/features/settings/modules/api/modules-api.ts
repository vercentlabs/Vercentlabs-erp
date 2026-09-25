"use client";

export class ModulesApiError extends Error {
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
    throw new ModulesApiError(payload.message || "The request could not be completed.", response.status);
  }
  return payload;
}

export type ModuleRow = {
  key: string;
  name: string;
  description: string;
  released: boolean;
  enabled: boolean;
  planIncluded: boolean;
  entitlementEnforced: boolean;
  availableToWorkspace: boolean;
  actorHasViewPermission: boolean;
};

export async function listModules(): Promise<{ modules: ModuleRow[] }> {
  return parseResponse(await fetch("/api/settings/modules"));
}

export async function setModuleEnabled(key: string, enabled: boolean): Promise<{ module: ModuleRow; changed: boolean }> {
  const response = await fetch(`/api/settings/modules/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return parseResponse(response);
}
