// Shape returned by the generic getCrmRecord/listCrmRecords for the
// "opportunities" resource — camelized tenant.crm_opportunities columns
// (see resource-registry.js's resources.opportunities.fields), plus
// projected fields (ownerName, stageName, partyName, contactName) this
// pass has not independently verified field-by-field.
export type Opportunity = {
  id: string;
  code: string;
  companyId: string | null;
  branchId: string | null;
  pipelineId: string;
  stageId: string;
  stageName?: string | null;
  leadId: string | null;
  partyId: string | null;
  partyName?: string | null;
  contactId: string | null;
  contactName?: string | null;
  campaignId: string | null;
  sourceId: string | null;
  ownerUserId: string | null;
  ownerName?: string | null;
  name: string;
  description: string | null;
  amount: number | null;
  currencyCode: string | null;
  probability: number | null;
  expectedRevenue: number | null;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  /** open | won | lost | archived — governed exclusively via the stage
   * transition action (moveOpportunityStage derives it from the target
   * stage's is_won/is_lost flags), never edited directly by this UI. */
  status: "open" | "won" | "lost" | "archived";
  forecastCategory: string | null;
  nextStep: string | null;
  lostReasonId: string | null;
  lossNotes: string | null;
  outcomeReasonId: string | null;
  outcomeNotes: string | null;
  customData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type OpportunityListFilters = {
  search?: string;
  status?: string;
  ownerId?: string;
  stageId?: string;
  pipelineId?: string;
  limit?: number;
  offset?: number;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
