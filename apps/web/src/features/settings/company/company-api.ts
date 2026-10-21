"use client";

// Browser client for Settings › Company and the person's own profile (Shared Platform plan 3).
export class CompanyApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly field?: string) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new CompanyApiError(payload.message || payload.error?.message || "The request could not be completed.", response.status, payload.code, payload.field);
  }
  return payload as T;
}

const send = <T>(path: string, body: unknown, method = "POST") =>
  fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).then(parse<T>);

export type BankAccount = { id: string; accountName: string; bankName: string; accountNumber: string; ifsc: string; branch: string | null; accountType: string; isDefault: boolean; showOnDocuments: boolean };
export type CompanyProfile = {
  name: string; legalName: string | null; pan: string | null; cin: string | null; udyamNumber: string | null;
  gstin: string | null; gstRegistrationId: string | null; gstRegistrationType: string | null;
  address: { line1: string | null; line2: string | null; city: string | null; stateCode: string | null; stateName: string | null; postalCode: string | null; countryCode: string };
  phone: string | null; email: string | null; website: string | null; upiId: string | null;
  timezone: string; baseCurrency: string; fiscalYearStartMonth: number; hasLogo: boolean; hasSignature: boolean;
  bankAccounts: BankAccount[]; onboardingCompletedAt: string | null; closureScheduledFor: string | null;
};
export type Closure = { requestedAt: string | null; closesOn: string | null; closedAt: string | null; waitingDays: number };
export type ExportFile = { id: string; fileName: string; sizeBytes: number; createdAt: string; expiresAt: string | null };
export type CompanyOverview = { profile: CompanyProfile; closure: Closure; exports: ExportFile[] };

export const getCompany = () => fetch("/api/settings/company", { credentials: "same-origin" }).then(parse<CompanyOverview>);
export const saveCompany = (input: Record<string, unknown>) => send<{ profile: CompanyProfile }>("/api/settings/company", input, "PUT");
export const saveBankAccount = (input: Record<string, unknown>) => send<{ bankAccounts: BankAccount[] }>("/api/settings/company/bank-accounts", input);
export const removeBankAccount = (id: string) => send<{ bankAccounts: BankAccount[] }>(`/api/settings/company/bank-accounts/${id}`, undefined, "DELETE");
export const uploadCompanyImage = (kind: "logo" | "signature", file: File) => {
  const form = new FormData();
  form.set("file", file);
  return fetch(`/api/settings/company/images/${kind}`, { method: "POST", credentials: "same-origin", body: form }).then(parse<{ fileId: string }>);
};
export const removeCompanyImage = (kind: "logo" | "signature") => send<{ removed: boolean }>(`/api/settings/company/images/${kind}`, undefined, "DELETE");
export const requestExport = () => send<{ jobId: string; alreadyRunning: boolean }>("/api/settings/company/export", {});
export const requestClosure = (input: { password: string; confirmName: string }) => send<{ closure: Closure }>("/api/settings/company/closure", input);
export const cancelClosure = () => send<{ closure: Closure }>("/api/settings/company/closure", undefined, "DELETE");
export const transferOwnership = (input: { targetUserId: string; password: string }) => send<{ ownerUserId: string }>("/api/settings/organization/ownership", input);
export const resetMemberMfa = (userId: string, reason: string) => send<{ reset: boolean }>(`/api/settings/users/${userId}/mfa-reset`, { reason });
export const signOutMember = (userId: string) => send<{ sessionsSignedOut: number }>(`/api/settings/users/${userId}/sign-out`, {});

export type OwnProfile = {
  fullName: string; email: string; phone: string | null; locale: string; timezone: string; timezoneIsCompany: boolean; dateFormat: string; numberFormat: string;
  passwordChangedAt: string | null; mfaEnrolled: boolean; hasPassword: boolean; pendingEmail: { email: string; expiresAt: string } | null;
  options: { dateFormats: string[]; numberFormats: string[]; languages: Array<{ code: string; name: string }> };
};
export const getOwnProfile = () => fetch("/api/settings/profile", { credentials: "same-origin" }).then(parse<{ profile: OwnProfile }>);
export const saveOwnProfile = (input: Record<string, unknown>) => send<{ profile: OwnProfile }>("/api/settings/profile", input, "PUT");
export const changePassword = (input: { currentPassword: string; newPassword: string }) => send<{ changed: boolean; otherSessionsSignedOut: number }>("/api/settings/profile/password", input);
export const changeEmail = (input: { newEmail: string; password: string }) => send<{ sentTo: string }>("/api/settings/profile/email", input);
