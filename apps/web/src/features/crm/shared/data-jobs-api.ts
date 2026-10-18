"use client";

// Browser client for CRM imports and exports run in the background (/api/crm/data-jobs): a file with more rows than an import takes
// at once, or an export with more rows than a download returns, is queued; the person is told when it finishes and downloads the result.
import { CrmApiError } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

const { request, parseResponse } = crmApiClient(CrmApiError);
const BASE = "/api/crm/data-jobs";

export type DataJobEntity = "leads" | "accounts" | "contacts" | "opportunities";
export type DataJob = {
  id: string;
  kind: "import" | "export";
  entity: DataJobEntity;
  entityLabel: string;
  status: "queued" | "running" | "succeeded" | "failed";
  fileName: string | null;
  result: { rowCount?: number; fileName?: string; total?: number; created?: number; updated?: number; failed?: number; won?: number; lost?: number; errors?: Array<{ row: number; message: string }> };
  error: string | null;
  hasOutput: boolean;
  requestedAt: string;
  completedAt: string | null;
};

// How many rows each import takes while the person waits, and how many an export downloads at once; above that, it runs in the background.
export const ON_SCREEN_IMPORT_LIMIT: Record<DataJobEntity, number> = { leads: 1000, accounts: 2000, contacts: 2000, opportunities: 2000 };
export const ON_SCREEN_EXPORT_LIMIT = 10000;
export const BACKGROUND_IMPORT_LIMIT = 20000;

export const listDataJobs = (entity?: DataJobEntity) =>
  request<{ jobs: DataJob[] }>(`${BASE}${entity ? `?entity=${entity}` : ""}`).then((result) => result.jobs);

export async function queueImport(entity: DataJobEntity, file: File, mapping: Record<string, string>, options: Record<string, unknown>) {
  const form = new FormData();
  form.set("file", file);
  form.set("entity", entity);
  form.set("mapping", JSON.stringify(mapping));
  form.set("options", JSON.stringify(options));
  return parseResponse<{ job: DataJob }>(await fetch(`${BASE}/import`, { method: "POST", body: form })).then((result) => result.job);
}

// filters: the list's export query string (everything after "?" in the record's export URL).
export const queueExport = (entity: DataJobEntity, exportUrl: string) => {
  const query = exportUrl.includes("?") ? exportUrl.slice(exportUrl.indexOf("?") + 1) : "";
  return request<{ job: DataJob }>(`${BASE}/export?entity=${entity}${query ? `&${query}` : ""}`, { method: "POST" }).then((result) => result.job);
};

export const dataJobDownloadUrl = (id: string) => `${BASE}/${id}/download`;

const IMPORT_DATA_TYPE: Record<DataJobEntity, string> = { leads: "leads", accounts: "companies", contacts: "contacts", opportunities: "deals" };

// A list's Export: the file downloads at once, or — above the on-screen limit — is queued and the Import data page opens on the run.
export async function startExport(entity: DataJobEntity, exportUrl: string, total: number, open: (href: string) => void) {
  if (total <= ON_SCREEN_EXPORT_LIMIT) {
    window.location.href = exportUrl;
    return;
  }
  try {
    await queueExport(entity, exportUrl);
    open(`/crm/data/import-export?type=${IMPORT_DATA_TYPE[entity]}`);
  } catch (failure) {
    window.alert(failure instanceof Error ? failure.message : "The export could not be started.");
  }
}
