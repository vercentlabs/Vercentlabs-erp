export type ReleaseGovernanceClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, any>> }>;
};

export type ReleaseGovernanceContext = {
  organizationId: string;
  userId: string;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  allowAllCompanies: boolean;
  permissions: string[];
  roleSlugs: string[];
};

export type ReleaseGovernanceHealth = {
  readiness: "ready" | "attention" | "blocked";
  riskBand: "low" | "medium" | "high";
  score: number;
  blockers: string[];
  warnings: string[];
  metrics: Record<string, number | null>;
};

export declare const RELEASE_CHECK_KEYS: readonly string[];

export declare class ReleaseGovernanceError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code?: string);
}

export declare function releaseContentHash(value: unknown): string;
export declare function evaluateReleaseReadiness(
  input?: Record<string, any>,
  policy?: Record<string, any>,
  now?: Date,
): ReleaseGovernanceHealth;
export declare function buildReleaseGovernanceSummary(
  input?: Record<string, any>,
): Record<string, any>;
export declare function releaseContext(
  session?: Record<string, any>,
): ReleaseGovernanceContext;
export declare function getReleaseGovernanceDashboard(
  client: ReleaseGovernanceClient,
  context: ReleaseGovernanceContext,
): Promise<Record<string, any>>;
export declare function recordReleaseCheckRun(
  client: ReleaseGovernanceClient,
  context: ReleaseGovernanceContext,
  input?: Record<string, any>,
): Promise<Record<string, any>>;
export declare function captureReleaseReadinessSnapshot(
  client: ReleaseGovernanceClient,
  context: ReleaseGovernanceContext,
  input?: Record<string, any>,
): Promise<Record<string, any>>;
export declare function upsertReleaseIncidentCase(
  client: ReleaseGovernanceClient,
  context: ReleaseGovernanceContext,
  input?: Record<string, any>,
): Promise<Record<string, any>>;
export declare function getReleaseGovernanceTimeline(
  client: ReleaseGovernanceClient,
  context: ReleaseGovernanceContext,
): Promise<Array<Record<string, any>>>;
