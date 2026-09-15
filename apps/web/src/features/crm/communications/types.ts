// tenant.crm_communications rows via the generic /api/crm/communications
// resource route. The generic list path always projects with a single
// per-row, sender-only participant check (record-policy.js's
// projectCrmRecord — deliberately not a full participant lookup, to keep
// the generic list route to one query per page) — so `contentVisibility`
// is "full" only for the sender or a crm.leads.view_sensitive caller,
// "metadata" (id/channel/direction/status/occurredAt only) otherwise.
// The dedicated per-record Timeline (already used in Lead/Opportunity
// 360s) resolves full participant membership and is the richer surface;
// this list is intentionally the coarser one.
export type Communication = {
  id: string;
  channel: "email" | "whatsapp" | "sms" | "call_log" | string;
  direction: "inbound" | "outbound" | null;
  status: string;
  occurredAt: string;
  contentVisibility?: "full" | "metadata";
  redacted?: boolean;
  leadId?: string | null;
  opportunityId?: string | null;
  partyId?: string | null;
  contactId?: string | null;
  provider?: string | null;
  subject?: string | null;
  body?: string | null;
  fromAddress?: string | null;
  toAddresses?: string[] | null;
};

export type CommunicationListFilters = {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
};

export type CommunicationListResponse = { rows: Communication[]; total: number; limit: number; offset: number };
