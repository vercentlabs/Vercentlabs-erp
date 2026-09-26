type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string };

export const WORKFLOW_LIMITS: Readonly<{ maxConditions: number; maxActions: number; maxNameLength: number; maxTitle: number; maxMessage: number; runsPerTick: number }>;
export const CONDITION_OPERATORS: ReadonlyArray<Readonly<{ key: "equals" | "not_equals" | "in" | "changed_includes"; label: string }>>;
export const WORKFLOW_ACTIONS: ReadonlyArray<Readonly<{ key: string; label: string; description: string }>>;
export const WORKFLOW_NOTIFICATION_CATEGORY: Readonly<Record<string, string>>;
export const WORKFLOW_ENTITY_LINKS: Readonly<Record<string, (id: string) => string>>;

export class WorkflowError extends Error {
  status: number;
  code: string;
}
export type WorkflowCondition = { field: string; operator: "equals" | "not_equals" | "in" | "changed_includes"; value: string | string[] };
export type WorkflowAction = { type: "notify"; recipient: { type: "event_field"; field: string } | { type: "user"; userId: string }; title: string; message: string };
export type WorkflowInput = { name: string; trigger: string; conditions?: WorkflowCondition[]; actions: WorkflowAction[]; status?: "active" | "inactive"; expectedVersion?: number };
export type WorkflowSummary = {
  id: string;
  name: string;
  status: "draft" | "active" | "inactive";
  trigger: string;
  triggerLabel: string;
  definition: { trigger: string; conditions: WorkflowCondition[]; actions: WorkflowAction[] };
  version: number;
  updatedAt: string;
  lastRunAt: string | null;
  failedRuns: number;
};
export function listWorkflows(client: Client, organizationId: string): Promise<WorkflowSummary[]>;
export function createWorkflow(client: Client, session: Session, input: WorkflowInput): Promise<WorkflowSummary>;
export function updateWorkflow(client: Client, session: Session, workflowId: string, input: WorkflowInput): Promise<WorkflowSummary>;
export function setWorkflowStatus(client: Client, session: Session, workflowId: string, status: "active" | "inactive"): Promise<WorkflowSummary>;
export function listWorkflowRecipients(client: Client, organizationId: string): Promise<Array<{ id: string; name: string }>>;
export function listWorkflowRuns(client: Client, organizationId: string, options?: { workflowId?: string | null; limit?: number }): Promise<
  Array<{ id: string; workflowId: string; version: number | null; trigger: string; triggerLabel: string; status: string; matched: boolean | null; actionsRun: number; error: string | null; startedAt: string | null; finishedAt: string | null; createdAt: string }>
>;
export function fanOutWorkflowRuns(client: Client, event: Record<string, any>): Promise<void>;
export function claimWorkflowRuns(client: Client, organizationId: string, options?: { limit?: number; leaseMilliseconds?: number }): Promise<Array<Record<string, any>>>;
export function evaluateWorkflowConditions(conditions: WorkflowCondition[], data: Record<string, unknown>): boolean;
export function executeWorkflowRun(client: Client, run: Record<string, any>): Promise<{ matched: boolean; actions: Array<Record<string, unknown>> }>;
export function failWorkflowRun(client: Client, runId: string, error: unknown): Promise<void>;
