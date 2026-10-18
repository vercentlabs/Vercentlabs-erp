import type { CrmContext, CrmMediumCode } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type CrmCampaign = {
  id: string; name: string; code: string | null; medium: CrmMediumCode | null; status: "active" | "archived"; startsOn: string | null; endsOn: string | null;
  budget: number | null; currencyCode: string | null; description: string | null; createdAt: string; updatedAt: string;
  stats?: { leads: number; convertedLeads: number; deals: number; openDeals: number; wonDeals: number; wonValue: number };
};
export const CAMPAIGN_PERMISSION: "crm.settings.manage";
export function listCampaignOptions(client: QueryClient, context: CrmContext): Promise<Array<{ id: string; name: string; code: string | null; medium: CrmMediumCode | null }>>;
export function listCampaigns(client: QueryClient, context: CrmContext, options?: { includeArchived?: boolean }): Promise<{ campaigns: CrmCampaign[]; currency: { reportingCurrency: string | null; unconvertedCount: number; unconvertedCurrencies: string[] } }>;
export function getCampaign(client: QueryClient, context: CrmContext, campaignId: string): Promise<CrmCampaign>;
export function createCampaign(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<CrmCampaign>;
export function updateCampaign(client: QueryClient, context: CrmContext, campaignId: string, input: Record<string, unknown>): Promise<CrmCampaign>;
export function setCampaignStatus(client: QueryClient, context: CrmContext, campaignId: string, status: "active" | "archived"): Promise<CrmCampaign>;
export function assertUsableCampaign(client: QueryClient, context: CrmContext, campaignId: string | null | undefined, currentId?: string | null): Promise<void>;
export function campaignFromUtm(client: QueryClient, organizationId: string, value: string | null | undefined): Promise<{ id: string; medium: string | null } | null>;
