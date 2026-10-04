import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

export const CONVERSION_PERMISSIONS: Readonly<Record<"convert" | "overrideQualification" | "useExisting" | "createAccount" | "createContact" | "changeOwner" | "overrideDuplicate", string>>;

export type ConversionCapabilities = Record<"convert" | "overrideQualification" | "useExisting" | "createAccount" | "createContact" | "changeOwner" | "overrideDuplicate", boolean>;
export function conversionCapabilities(context: CrmContext): ConversionCapabilities;

export type ConversionCheck = { key: string; label: string; met: boolean; overridable: boolean; value: string | null };
export type ConversionLeadSummary = {
  id: string; code: string; name: string | null; firstName: string | null; lastName: string | null; company: string | null; jobTitle: string | null;
  email: string | null; phone: string | null; mobile: string | null; website: string | null; city: string | null; industry: string | null;
  ownerUserId: string | null; ownerName: string | null; teamId: string | null; teamName: string | null; sourceId: string | null; sourceName: string | null;
  productInterest: string | null; estimatedValue: number | null; currencyCode: string | null; rating: string | null; priority: string | null; status: string;
  description: string | null; createdAt: string; qualifiedAt: string | null; qualifiedByName: string | null;
  qualification: { score: number; suggestedRating: string; checklist: Array<{ key: string; label: string; done: boolean; value: string | null }> };
};
export type ConversionDifference = { field: string; label: string; existing: string | null; lead: string | null };
export type ConversionAccountMatch = {
  id: string; code: string | null; name: string; legalName?: string | null; website?: string | null; city?: string | null; ownerName?: string | null;
  accountType?: string | null; isCustomer?: boolean; isArchived?: boolean; strength: string; signals: string[]; canOpen: boolean; differences?: ConversionDifference[];
};
export type ConversionContactMatch = {
  id: string; code: string | null; name: string; jobTitle?: string | null; email?: string | null; mobile?: string | null; accountId?: string | null;
  accountName?: string | null; ownerName?: string | null; isArchived?: boolean; strength: string; signals: string[]; canOpen: boolean; conflicts?: ConversionDifference[];
};
export type ConversionOpportunityMatch = {
  id: string; code: string; name: string; accountId: string; amount: number; currencyCode: string | null; productInterest: string | null; stageName: string | null; ownerName: string | null; similar: boolean;
};
export type LeadConversion = {
  id: string; leadId: string; leadCode: string; partyId: string | null; accountName: string | null; contactId: string | null; contactName: string | null;
  opportunityId: string | null; opportunityCode: string | null; opportunityName: string | null; accountDecision: "existing" | "new" | null;
  contactDecision: "existing" | "new" | null; qualificationOverride: boolean; overrideReason: string | null; duplicateOverrideReason: string | null;
  openWork: "move" | "keep" | null; movedWorkCount: number; convertedBy: string | null; convertedByName: string | null; convertedAt: string; replayed: boolean;
};
export type LeadConversionPreview = {
  lead: ConversionLeadSummary;
  blocked: { code: string; message: string } | null;
  conversion: LeadConversion | null;
  capabilities: ConversionCapabilities;
  checks?: ConversionCheck[];
  missing?: Array<{ key: string; label: string }>;
  requiresOverride?: boolean;
  canConvert?: boolean;
  accountMatches?: ConversionAccountMatch[];
  contactMatches?: ConversionContactMatch[];
  opportunityMatches?: ConversionOpportunityMatch[];
  stages?: Array<{ id: string; name: string; probability: number; pipelineName: string }>;
  openWork?: { tasks: number; followUps: number };
  defaults?: {
    account: { mode: "existing"; id: string } | { mode: "new"; name: string; website: string; industry: string; ownerUserId: string | null };
    contact: { mode: "existing"; id: string } | { mode: "new"; firstName: string; lastName: string; email: string; mobile: string; phone: string; jobTitle: string; ownerUserId: string | null };
    opportunity: {
      name: string; ownerUserId: string | null; teamId: string | null; stageId: string | null; amount: number | null; currencyCode: string | null;
      expectedCloseDate: string | null; productInterest: string; description: string; priority: string;
    };
    openWork: "move" | "keep";
  };
};
export type LeadConversionInput = {
  idempotencyKey?: string;
  account?: { mode?: "existing"; id: string } | { mode?: "new"; name?: string; legalName?: string; website?: string; gstin?: string; industry?: string; ownerUserId?: string; acknowledgeMatches?: boolean };
  contact?: { mode?: "existing"; id: string; updates?: Partial<Record<"email" | "mobile" | "phone" | "jobTitle", "lead" | "existing">> }
    | { mode?: "new"; firstName?: string; lastName?: string; email?: string; mobile?: string; phone?: string; jobTitle?: string; ownerUserId?: string; acknowledgeMatches?: boolean };
  opportunity?: {
    name?: string; ownerUserId?: string; teamId?: string | null; stageId?: string; amount?: number | string | null; currencyCode?: string;
    expectedCloseDate?: string; productInterest?: string; description?: string; priority?: string; acknowledgeMatches?: boolean;
  };
  openWork?: "move" | "keep";
  overrideReason?: string;
  duplicateReason?: string;
};
export type LeadConversionMetrics = {
  period: { from: string; to: string }; converted: number; convertedWithOverride: number; averageDaysToConvert: number | null;
  leadsCreated: number; leadsCreatedAndConverted: number; conversionRate: number;
  byOwner: Array<{ userId: string | null; name: string; converted: number }>;
  bySource: Array<{ sourceId: string | null; name: string; converted: number }>;
};

export function previewLeadConversion(client: QueryClient, context: CrmContext, leadId: string, options?: { accountId?: string | null }): Promise<LeadConversionPreview>;
export function convertLead(client: QueryClient, context: CrmContext, leadId: string, input?: LeadConversionInput): Promise<LeadConversion>;
export function getLeadConversion(client: QueryClient, context: CrmContext, leadId: string): Promise<LeadConversion | null>;
export function getLeadConversionMetrics(client: QueryClient, context: CrmContext, input?: { from?: string; to?: string }): Promise<LeadConversionMetrics>;
