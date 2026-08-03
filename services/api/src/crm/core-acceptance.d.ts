export type CrmCoreAcceptanceClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, any>> }>;
};

export type CrmCoreAcceptanceContext = {
  organizationId: string;
  userId: string;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  allowAllCompanies: boolean;
  permissions: string[];
  roleSlugs: string[];
};

export type CrmCoreAcceptanceHealth = {
  readiness: "ready" | "attention" | "blocked";
  riskBand: "low" | "medium" | "high";
  score: number;
  blockers: string[];
  warnings: string[];
  metrics: Record<string, number>;
};

export declare const CRM_CORE_CAPABILITY_IDS: readonly string[];
export declare const CRM_CORE_SURFACE_CHECKS: readonly string[];
export declare const CRM_CORE_CHECK_KEYS: readonly string[];

export declare class CrmCoreAcceptanceError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code?: string);
}

export declare function crmCoreContentHash(value: unknown): string;
export declare function evaluateCrmCoreAcceptance(
  input?: Record<string, any>,
): CrmCoreAcceptanceHealth;
export declare function buildCrmCoreAcceptanceSummary(
  input?: Record<string, any>,
): Record<string, any>;
export declare function crmCoreAcceptanceContext(
  session?: Record<string, any>,
): CrmCoreAcceptanceContext;
export declare function getCrmCoreAcceptanceDashboard(
  client: CrmCoreAcceptanceClient,
  context: CrmCoreAcceptanceContext,
): Promise<Record<string, any>>;
export declare function recordCrmCoreAcceptanceRun(
  client: CrmCoreAcceptanceClient,
  context: CrmCoreAcceptanceContext,
  input?: Record<string, any>,
): Promise<Record<string, any>>;
export declare function captureCrmCoreAcceptanceSnapshot(
  client: CrmCoreAcceptanceClient,
  context: CrmCoreAcceptanceContext,
  input?: Record<string, any>,
): Promise<Record<string, any>>;
export declare function getCrmCoreAcceptanceTimeline(
  client: CrmCoreAcceptanceClient,
  context: CrmCoreAcceptanceContext,
): Promise<Array<Record<string, any>>>;
