type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string };
export const AI_TOOLS: ReadonlyArray<Readonly<{ key: string; label: string; description: string }>>;
export const AI_POLICY_KEYS: readonly string[];
export function getAiTool(key: string): (typeof AI_TOOLS)[number] | null;
export const AI_POLICY_DISABLED: string;
export const AI_POLICY_MISSING: string;
export const AI_APPROVAL_REQUIRED: string;
export const AI_TOOL_DENIED: string;
export class AiGovernanceError extends Error {
  status: number;
  code: string;
}
export function assertAiActionPolicy(input: { enabled: boolean; allowRead: boolean; allowPropose: boolean; allowExecute: boolean; requiresApproval: boolean; requestType: string }): void;
export function setAiPolicy(client: Client, session: Session, input: Record<string, unknown>): Promise<{ id: string; version: number }>;
export function listAiPolicies(client: Client, organizationId: string): Promise<Array<Record<string, any>>>;
export function recordAiEvaluation(client: Client, session: Session, input: Record<string, unknown>): Promise<{ id: string; passed: boolean }>;
export function recordAiRequest(client: Client, session: Session, input: Record<string, unknown>): Promise<{ id: string; status: string }>;
export function getAiGovernanceOverview(client: Client, organizationId: string): Promise<{
  policy: Record<string, any> | null;
  versions: Array<Record<string, any>>;
  requests: Array<Record<string, any>>;
  tools: Array<{ key: string; label: string; description: string }>;
  dataClasses: Array<{ key: string; label: string }>;
}>;
