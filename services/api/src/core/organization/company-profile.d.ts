type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Session = { organizationId: string; userId: string; sessionId?: string; roleSlugs?: readonly string[]; permissions?: readonly string[] };
export declare class CompanyProfileError extends Error { status: number; code: string; details?: unknown }
export const COMPANY_IMAGE_KINDS: Readonly<{ logo: string; signature: string }>;
export type CompanyBankAccount = { id: string; accountName: string; bankName: string; accountNumber: string; ifsc: string; branch: string | null; accountType: string; isDefault: boolean; showOnDocuments: boolean };
export type CompanyProfile = {
  name: string; legalName: string | null; pan: string | null; cin: string | null; udyamNumber: string | null;
  gstin: string | null; gstRegistrationId: string | null; gstRegistrationType: string | null;
  address: { line1: string | null; line2: string | null; city: string | null; stateCode: string | null; stateName: string | null; postalCode: string | null; countryCode: string };
  phone: string | null; email: string | null; website: string | null; upiId: string | null;
  timezone: string; baseCurrency: string; fiscalYearStartMonth: number; hasLogo: boolean; hasSignature: boolean;
  bankAccounts: CompanyBankAccount[]; onboardingCompletedAt: string | null; closureScheduledFor: string | null;
};
export function getCompanyProfile(client: Queryable, organizationId: string): Promise<CompanyProfile>;
export function updateCompanyProfile(client: Queryable, session: Session, input: Record<string, unknown>): Promise<CompanyProfile>;
export function listCompanyBankAccounts(client: Queryable, organizationId: string): Promise<CompanyBankAccount[]>;
export function saveCompanyBankAccount(client: Queryable, session: Session, input: Record<string, unknown>): Promise<CompanyBankAccount[]>;
export function removeCompanyBankAccount(client: Queryable, session: Session, id: string): Promise<CompanyBankAccount[]>;
export function prepareCompanyImage(input: { fileName: string; bytes: Buffer }, env?: any): Promise<any>;
export function setCompanyImage(client: Queryable, session: Session, kind: "logo" | "signature", prepared: any, options?: any): Promise<{ fileId: string }>;
export function removeCompanyImage(client: Queryable, session: Session, kind: "logo" | "signature"): Promise<{ removed: boolean }>;
export function readCompanyImage(client: Queryable, organizationId: string, kind: "logo" | "signature", options?: any): Promise<{ fileName: string; mimeType: string; body: Buffer } | null>;
