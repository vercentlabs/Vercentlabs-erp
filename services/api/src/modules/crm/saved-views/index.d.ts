import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type SavedViewScreen = "leads" | "opportunities" | "pipeline";
export type CrmSavedView = { id: string; screen: SavedViewScreen; name: string; query: string; isDefault: boolean; updatedAt: string };
export function listSavedViews(client: QueryClient, context: CrmContext, screen: string): Promise<CrmSavedView[]>;
export function saveView(client: QueryClient, context: CrmContext, input: { screen: string; name: string; query: string; isDefault?: boolean }): Promise<CrmSavedView>;
export function setDefaultView(client: QueryClient, context: CrmContext, viewId: string, isDefault: boolean): Promise<CrmSavedView>;
export function deleteSavedView(client: QueryClient, context: CrmContext, viewId: string): Promise<{ deleted: true }>;
