export type DocumentModel = {
  title: string;
  documentNumber?: string | null;
  issuedAt?: string | null;
  organizationName?: string | null;
  status?: string | null;
  parties?: Array<{ label: string; lines: string[] }>;
  fields?: Array<{ label: string; value: string | number | null }>;
  table?: { columns: Array<{ key: string; label: string; align?: "left" | "right" | "center"; width?: string }>; rows: Array<Record<string, unknown>> };
  totals?: Array<{ label: string; value: string; emphasis?: boolean }>;
  notes?: Array<{ label: string; text: string }>;
  footer?: string | null;
};
export function validateDocumentModel(model: DocumentModel): DocumentModel;
export function renderDocumentPdf(model: DocumentModel): Promise<Buffer>;
export function safePdfFileName(base: string): string;
