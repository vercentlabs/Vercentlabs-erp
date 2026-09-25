// Field targets lead-acquisition.js's ALLOWED_IMPORT_FIELDS accepts for
// mapping (normalizeLeadFieldMapping throws for anything outside this
// list) — kept in sync with that set, not invented independently.
export const LEAD_IMPORT_FIELDS: Array<{ target: string; label: string; required?: boolean }> = [
  { target: "firstName", label: "First name", required: true },
  { target: "lastName", label: "Last name" },
  { target: "email", label: "Email" },
  { target: "phone", label: "Phone" },
  { target: "mobile", label: "Mobile" },
  { target: "companyName", label: "Company name" },
  { target: "jobTitle", label: "Job title" },
  { target: "website", label: "Website" },
  { target: "industry", label: "Industry" },
  { target: "city", label: "City" },
  { target: "state", label: "State" },
  { target: "countryCode", label: "Country code" },
  { target: "productInterest", label: "Product interest" },
  { target: "estimatedValue", label: "Estimated value" },
  { target: "currencyCode", label: "Currency code" },
];

export type LeadImportRowResult = {
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized: Record<string, unknown>;
  errors: Array<{ field: string; message: string }>;
  valid: boolean;
};

export type LeadImportBatch = {
  id: string;
  file_name: string;
  status: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  created_rows?: number;
  updated_rows?: number;
  skipped_rows?: number;
  created_at: string;
};

export type LeadImportPreviewResult = { batch: LeadImportBatch; rows: LeadImportRowResult[]; idempotent: boolean };
export type LeadImportRollbackResult = { rolledBack: number; protected: number };

// tenant.background_jobs row for job_type='crm.leads.export' — see
// getCrmLeadExportJob (lead-export.js). manifest never carries the CSV
// itself (the status route strips it); only the download route does.
export type LeadExportJob = {
  id: string;
  status: "pending" | "processing" | "completed" | "dead" | "cancelled";
  progress: { rowCount?: number; truncated?: boolean; generatedAt?: string; expiresAt?: string; columns?: string[] };
  manifest: { rowCount?: number; truncated?: boolean; generatedAt?: string; expiresAt?: string; columns?: string[] };
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
};
