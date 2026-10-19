type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Session = { organizationId: string; userId: string; sessionId?: string; roleSlugs?: readonly string[]; permissions?: readonly string[] };
import type { CompanyProfile } from "./company-profile.js";
export const SETUP_STEPS: readonly ["legal", "financial_year", "app", "people", "data"];
export type SetupStep = { key: string; label: string; done: boolean; optional?: boolean; missing: string[] };
export type SetupProgress = { steps: SetupStep[]; completedAt: string | null; readyToFinish: boolean; nextStep: string | null; profile: CompanyProfile };
export function getSetupProgress(client: Queryable, organizationId: string): Promise<SetupProgress>;
export function markSetupStep(client: Queryable, session: Session, step: string): Promise<SetupProgress>;
export function completeSetup(client: Queryable, session: Session): Promise<SetupProgress>;
