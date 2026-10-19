type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string };

export const WORKFLOW_LIMITS: Readonly<{ maxConditions: number; maxActions: number; maxNameLength: number; maxTitle: number; maxMessage: number; runsPerTick: number }>;
export const CONDITION_OPERATORS: ReadonlyArray<Readonly<{ key: "equals" | "not_equals" | "in" | "changed_includes" | "greater_than" | "less_than"; label: string }>>;
export const WORKFLOW_ACTIONS: ReadonlyArray<Readonly<{ key: string; label: string; description: string; module?: string }>>;
export const WORKFLOW_MODULE_ACTIONS: Readonly<Record<string, () => Promise<{ validate: (...args: any[]) => Promise<WorkflowAction>; execute: (...args: any[]) => Promise<Record<string, unknown>> }>>>;
export const WORKFLOW_NOTIFICATION_CATEGORY: Readonly<Record<string, string>>;
export const WORKFLOW_ENTITY_LINKS: Readonly<Record<string, (id: string) => string>>;
export const WORKFLOW_ACTIVITY_RECORDS: Readonly<Record<string, string>>;
export const WORKFLOW_ASSIGNABLE: Readonly<Record<string, { table: string; column: string; label: string }>>;
export type TimeTrigger = Readonly<{ key: string; moduleKey: string; label: string; description: string; entityType: string; conditionFields: ReadonlyArray<{ key: string; label: string; type?: string }>; sql: string }>;
export const TIME_TRIGGERS: readonly TimeTrigger[];
export const TIME_TRIGGER_OFFSET: Readonly<{ min: number; max: number }>;
export function getTimeTrigger(key: string): TimeTrigger | null;
export function queueTimeTriggeredRuns(client: Client, organizationId: string, day?: string | null): Promise<number>;

export class WorkflowError extends Error {
  status: number;
  code: string;
}
export type WorkflowCondition = { field: string; operator: "equals" | "not_equals" | "in" | "changed_includes" | "greater_than" | "less_than"; value: string | string[] };
export type WorkflowAction =
  | { type: "notify"; recipient: { type: "event_field"; field: string } | { type: "user"; userId: string }; title: string; message: string }
  | { type: "crm.create_follow_up"; followUpType: string; inHours: number; subject?: string; assignee: { type: "record_owner" } | { type: "user"; userId: string } | { type: "event_field"; field: string } }
  | { type: "crm.assign_owner"; userId: string }
  | { type: "crm.set_priority"; priority: "low" | "medium" | "high" }
  | { type: "crm.add_tag"; tag: string }
  | { type: "crm.send_email"; templateId: string }
  | { type: "crm.notify_followers"; title: string; message?: string }
  | { type: "send_email"; to: { type: "event_field"; field: string } | { type: "user"; userId: string } | { type: "address"; email: string }; subject: string; body: string }
  | { type: "create_activity"; activityType: "to_do" | "call" | "meeting" | "email"; summary: string; inDays: number; assignee: { type: "event_field"; field: string } | { type: "user"; userId: string } }
  | { type: "assign"; userId: string };
export type WorkflowInput = { name: string; trigger: string; offsetDays?: number; conditions?: WorkflowCondition[]; actions: WorkflowAction[]; status?: "active" | "inactive"; expectedVersion?: number };
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
