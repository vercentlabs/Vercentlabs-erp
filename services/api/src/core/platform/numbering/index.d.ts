type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string };

export type DocumentScope = "organization" | "company";
export type ResetPolicy = "never" | "calendar_year" | "fiscal_year";
export type DocumentTypeDefinition = Readonly<{
  key: string;
  moduleKey: string;
  label: string;
  scope: DocumentScope;
  defaultPrefix: string;
  defaultPadding: number;
  configurable: boolean;
  family?: boolean;
}>;
export const DOCUMENT_TYPES: readonly DocumentTypeDefinition[];
export const RESET_POLICIES: readonly ResetPolicy[];
export function getDocumentType(documentType: string): DocumentTypeDefinition | null;

export class DocumentNumberError extends Error {
  status: number;
  code: string;
}
export function formatDocumentNumber(input: { prefix: string; padding: number; value: number | string; periodLabel?: string | null }): string;
export function nextDocumentNumber(
  client: Client,
  context: { organizationId: string; companyId?: string | null; activeCompanyId?: string | null },
  input: { documentType: string; prefix?: string; padding?: number; periodKey?: string; at?: Date },
): Promise<string>;
export type NumberingTypeOverview = {
  documentType: string;
  label: string;
  moduleKey: string;
  scope: DocumentScope;
  configurable: boolean;
  customized: boolean;
  prefix: string;
  padding: number;
  resetPolicy: ResetPolicy;
  version: number;
  nextValue: number;
  nextNumberPreview: string;
};
export function getNumberingOverview(client: Client, organizationId: string, companyId: string, options?: { at?: Date }): Promise<{ companyId: string; fiscalYearStartMonth: number; types: NumberingTypeOverview[] }>;
export function setNumberingPolicy(
  client: Client,
  session: Session,
  input: { documentType: string; companyId?: string | null; prefix: string; padding: number; resetPolicy: ResetPolicy; expectedVersion?: number | null },
): Promise<{ documentType: string; companyId: string | null; prefix: string; padding: number; resetPolicy: ResetPolicy; version: number }>;
export function advanceNumberingCounter(client: Client, session: Session, input: { documentType: string; companyId?: string | null; nextValue: number }): Promise<{ documentType: string; nextValue: number }>;
