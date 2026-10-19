type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Session = { organizationId: string; userId: string; sessionId?: string; roleSlugs?: readonly string[]; permissions?: readonly string[] };
export declare class ProfileError extends Error { status: number; code: string; details?: unknown }
export const DATE_FORMATS: readonly string[];
export const NUMBER_FORMATS: readonly string[];
export const LANGUAGES: ReadonlyArray<{ code: string; name: string }>;
export type OwnProfile = {
  fullName: string; email: string; phone: string | null; locale: string; timezone: string; timezoneIsCompany: boolean; dateFormat: string; numberFormat: string;
  passwordChangedAt: string | null; mfaEnrolled: boolean; pendingEmail: { email: string; expiresAt: string } | null;
  options: { dateFormats: readonly string[]; numberFormats: readonly string[]; languages: ReadonlyArray<{ code: string; name: string }> };
};
export function sendSecurityAlert(user: { email: string }, input: { subject: string; heading: string; message: string }, env?: any): Promise<boolean>;
export function getOwnProfile(client: Queryable, session: Session): Promise<OwnProfile>;
export function updateOwnProfile(client: Queryable, session: Session, input: Record<string, unknown>): Promise<OwnProfile>;
export function changeOwnPassword(client: Queryable, session: Session, input: { currentPassword: string; newPassword: string }, env?: any): Promise<{ changed: boolean; otherSessionsSignedOut: number }>;
export function requestEmailChange(client: Queryable, session: Session, input: { newEmail: string; password: string }, env?: any): Promise<{ sentTo: string; expiresInHours: number }>;
export function confirmEmailChange(client: Queryable, token: string, env?: any): Promise<{ email: string }>;
