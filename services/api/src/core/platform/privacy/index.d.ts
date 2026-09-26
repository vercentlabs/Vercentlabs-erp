type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string };
export type PrivacyEnforcement = "review_required" | "statutory_hold" | "automatic_expiry";
export const PRIVACY_DATA_CLASSES: ReadonlyArray<Readonly<{ key: string; moduleKey: string | null; label: string; enforcement: PrivacyEnforcement; note: string }>>;
export function getPrivacyDataClass(key: string): (typeof PRIVACY_DATA_CLASSES)[number] | null;
export class PrivacyError extends Error {
  status: number;
  code: string;
}
export function assertPrivacyTransition(current: string, next: string): void;
export function createPrivacyRequest(client: Client, session: Session, input: Record<string, unknown>): Promise<{ id: string; status: string }>;
export function transitionPrivacyRequest(client: Client, session: Session, id: string, next: string, resultPayload?: unknown): Promise<{ status: string; completed_at: string | null }>;
export function listPrivacyRequests(client: Client, organizationId: string): Promise<Array<Record<string, any> & { allowedTransitions: string[] }>>;
export function writeRetentionPolicy(client: Client, session: Session, input: Record<string, unknown>): Promise<{ id: string; version: number }>;
export function listRetentionPolicies(client: Client, organizationId: string): Promise<Array<Record<string, any> & { dataClassLabel: string; enforcement: PrivacyEnforcement; enforcementNote: string }>>;
export function listPrivacyDataClasses(): Array<{ key: string; label: string; moduleKey: string | null; enforcement: PrivacyEnforcement; note: string }>;
