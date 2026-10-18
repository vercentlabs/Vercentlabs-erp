import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export function prepareRecordImage(input: { fileName: string; bytes: Uint8Array }, env?: Record<string, string | undefined>): Promise<any>;
export function setRecordImage(client: QueryClient, context: CrmContext, type: "party" | "contact", id: string, input: { prepared: any }, options?: Record<string, unknown>): Promise<{ fileId: string; fileName: string }>;
export function removeRecordImage(client: QueryClient, context: CrmContext, type: "party" | "contact", id: string): Promise<{ removed: boolean }>;
export function readRecordImage(client: QueryClient, context: CrmContext, type: "party" | "contact", id: string, options?: Record<string, unknown>): Promise<{ fileName: string; mimeType: string; body: Buffer } | null>;
