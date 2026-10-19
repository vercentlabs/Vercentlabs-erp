export class DataExchangeError extends Error {
  status: number;
  code: string;
  details?: unknown;
}
export const CSV_LIMITS: Readonly<{ maxBytes: number; maxRows: number; maxColumns: number; maxFieldLength: number }>;
export function decodeCsvText(buffer: Uint8Array): string | null;
export function parseCsvUpload(bytes: Uint8Array, limits?: Partial<{ maxBytes: number; maxRows: number; maxColumns: number; maxFieldLength: number }>): { headers: string[]; records: Record<string, string>[]; rowCount: number };
