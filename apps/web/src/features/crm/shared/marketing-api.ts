"use client";

// Browser client for campaigns and tags (CRM plan 3.4): /api/crm/campaigns, /api/crm/tags, and a lead's or deal's tags.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class MarketingApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(MarketingApiError, "body");

export type TagColor = "neutral" | "blue" | "green" | "amber" | "red" | "purple" | "teal";
export type CrmTag = { id: string; name: string; color: TagColor; leadCount?: number; dealCount?: number };
export type CampaignOption = { id: string; name: string; code: string | null; medium: string | null };
export type MediumOption = { code: string; label: string };
export type Campaign = {
  id: string; name: string; code: string | null; medium: string | null; status: "active" | "archived"; startsOn: string | null; endsOn: string | null;
  budget: number | null; currencyCode: string | null; description: string | null; createdAt: string; updatedAt: string;
  stats?: { leads: number; convertedLeads: number; deals: number; openDeals: number; wonDeals: number; wonValue: number };
};
export type CampaignList = { campaigns: Campaign[]; currency: { reportingCurrency: string | null; unconvertedCount: number; unconvertedCurrencies: string[] } };

export const TAG_COLORS: TagColor[] = ["neutral", "blue", "green", "amber", "red", "purple", "teal"];
export const TAG_COLOR_LABELS: Record<TagColor, string> = { neutral: "Grey", blue: "Blue", green: "Green", amber: "Amber", red: "Red", purple: "Purple", teal: "Teal" };

export const listCampaigns = () => request<CampaignList>("/api/crm/campaigns");
export const createCampaign = (input: Record<string, unknown>) => request<{ campaign: Campaign }>("/api/crm/campaigns", { method: "POST", json: input }).then((result) => result.campaign);
export const updateCampaign = (id: string, input: Record<string, unknown>) =>
  request<{ campaign: Campaign }>(`/api/crm/campaigns/${id}`, { method: "PATCH", json: input }).then((result) => result.campaign);
export const setCampaignStatus = (id: string, status: "active" | "archived") =>
  request<{ campaign: Campaign }>(`/api/crm/campaigns/${id}/status`, { method: "POST", json: { status } }).then((result) => result.campaign);

export const listTags = (withCounts = false) => request<{ tags: CrmTag[] }>(`/api/crm/tags${withCounts ? "?counts=1" : ""}`).then((result) => result.tags);
export const createTag = (input: { name: string; color?: TagColor }) => request<{ tag: CrmTag }>("/api/crm/tags", { method: "POST", json: input }).then((result) => result.tag);
export const updateTag = (id: string, input: { name?: string; color?: TagColor }) =>
  request<{ tag: CrmTag }>(`/api/crm/tags/${id}`, { method: "PATCH", json: input }).then((result) => result.tag);
export const deleteTag = (id: string) => request<{ deleted: true }>(`/api/crm/tags/${id}`, { method: "DELETE" });
export const setRecordTags = (entity: "lead" | "opportunity", id: string, tags: Array<{ id: string } | { name: string }>) =>
  request<{ tags: CrmTag[] }>(`/api/crm/${entity === "lead" ? "leads" : "opportunities"}/${id}/tags`, { method: "PUT", json: { tags } }).then((result) => result.tags);

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

// A record's campaign choices: the active campaigns, plus the one it already names when that one has since been archived.
export function campaignChoices(campaigns: CampaignOption[], currentId: string | null, currentName: string | null) {
  const list = campaigns.map((entry) => ({ value: entry.id, label: entry.name }));
  if (currentId && !campaigns.some((entry) => entry.id === currentId)) list.push({ value: currentId, label: `${currentName ?? "Campaign"} (archived)` });
  return list;
}
