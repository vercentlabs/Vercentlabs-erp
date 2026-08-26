export type LeadQualificationState = "not_reviewed" | "qualified" | "unqualified";
export type LeadQualificationCriterion = { key: string; label: string; met: boolean; help?: string };
export declare const LEAD_QUALIFICATION_STATES: readonly LeadQualificationState[];
export declare const LEAD_UNQUALIFICATION_REASONS: readonly { code: string; label: string }[];
export declare const LEAD_QUALIFICATION_MUTATION_FIELDS: readonly string[];
export declare class LeadQualificationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
}
export declare function assertNoQualificationMutation(input?: Record<string, unknown>): void;
export declare function evaluateLeadQualificationReadiness(lead?: Record<string, unknown>): {
  ready: boolean;
  required: LeadQualificationCriterion[];
  recommended: LeadQualificationCriterion[];
};
export declare function getLeadQualification(client: any, context: any, leadId: string): Promise<any>;
export declare function decideLeadQualification(client: any, context: any, leadId: string, input?: Record<string, unknown>): Promise<any>;
