import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

export type CloseOutcome = "won" | "lost";
export type CloseReason = {
  id: string; code: string; name: string; outcome: CloseOutcome; category: string; sequence: number; active: boolean;
  requiresNotes: boolean; capturesCompetitor: boolean; requiresCompetitor: boolean; offersFollowUp: boolean; linksDuplicate: boolean; useCount?: number;
};
export type CloseReasonInput = {
  outcome?: CloseOutcome; name?: string; category?: string;
  requiresNotes?: boolean; capturesCompetitor?: boolean; requiresCompetitor?: boolean; offersFollowUp?: boolean; linksDuplicate?: boolean;
};
export type WinLossReport = {
  period: { from: string; to: string }; groupBy: string; groupLabel: string;
  totals: { won: number; lost: number; wonValue: number; lostValue: number; winRate: number | null; topLostReason: string | null };
  wonReasons: Array<{ reasonId: string | null; name: string; count: number; share: number; value: number }>;
  lostReasons: Array<{ reasonId: string | null; name: string; count: number; share: number; value: number }>;
  groups: Array<{ key: string; label: string; won: number; lost: number; wonValue: number; lostValue: number; winRate: number | null; topLostReason: string | null; topWonReason: string | null }>;
};

export const CLOSE_REASON_PERMISSIONS: Readonly<{ manage: string; correct: string }>;
export const CLOSE_REASON_CATEGORIES: ReadonlyArray<{ code: string; label: string }>;
export const CLOSE_REPORT_GROUPS: Readonly<Record<string, string>>;
export const DEFAULT_CLOSE_REASONS: ReadonlyArray<{ code: string; name: string; category: string; outcome: CloseOutcome }>;

export function ensureDefaultCloseReasons(client: QueryClient, context: CrmContext): Promise<void>;
export function listCloseReasons(client: QueryClient, context: CrmContext, options?: { outcome?: CloseOutcome; includeInactive?: boolean }): Promise<CloseReason[]>;
export function createCloseReason(client: QueryClient, context: CrmContext, input: CloseReasonInput): Promise<CloseReason>;
export function updateCloseReason(client: QueryClient, context: CrmContext, reasonId: string, input: CloseReasonInput): Promise<CloseReason>;
export function setCloseReasonActive(client: QueryClient, context: CrmContext, reasonId: string, active: boolean): Promise<{ id: string; active: boolean }>;
export function reorderCloseReasons(client: QueryClient, context: CrmContext, input: { outcome: CloseOutcome; reasonIds: string[] }): Promise<CloseReason[]>;
export function deleteCloseReason(client: QueryClient, context: CrmContext, reasonId: string): Promise<{ deleted: boolean }>;
export function getWinLossReport(client: QueryClient, context: CrmContext, input?: { from?: string; to?: string; groupBy?: string; ownerId?: string; teamId?: string; sourceId?: string; outcome?: CloseOutcome }): Promise<WinLossReport>;
