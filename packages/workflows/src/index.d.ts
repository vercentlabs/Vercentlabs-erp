export class WorkflowConflictError extends Error {}
export function assertApprovalDecision(input: unknown): Readonly<{ decision: "approved" | "rejected" | "cancelled"; note: string | null; expectedVersion: number }>;
export function assertSeparationOfDuties(input: { requestedBy?: string | null; actorUserId: string; allowSelfApproval?: boolean }): void;
export function createCommandRegistry(definitions: readonly { key: string; validate(payload: unknown): unknown; execute(context: unknown, payload: unknown): Promise<unknown> }[]): Readonly<{ keys(): readonly string[]; get(key: string): unknown; validate(key: string, payload: unknown): unknown; execute(key: string, context: unknown, payload: unknown): Promise<unknown> }>;
export function transition(current: string, next: string, transitions: Record<string, readonly string[]>): string;
