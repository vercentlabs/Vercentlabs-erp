"use client";

import { Ban, UserPlus } from "lucide-react";
import {
  Button,
  ConflictBanner,
  RelatedBusinessFlow,
  Select,
  TextField,
  type BusinessFlowNode,
  type SelectOption,
} from "@vercentlabs/design-system";
import type { Dispatch, SetStateAction } from "react";
import { LeadTagsPanel } from "../components/LeadTagsPanel";
import { LeadDuplicatesWorkspacePanel } from "../components/LeadDuplicatesWorkspacePanel";
import { money } from "@/features/crm/shared/format";
import { countryName } from "@/shared/format/human";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import type { Lead } from "../types";

// Overview tab: outcome banners, tags, duplicates, contact and company
// details, and owner assignment.
export function LeadOverviewTab({
  leadId,
  lead,
  router,
  conflictMessage,
  actionError,
  conversionFlow,
  isClosed,
  canManageLeads,
  canResolveDuplicates,
  invalidateLead,
  ownerOptions,
  pendingOwnerId,
  setPendingOwnerId,
  assignReason,
  setAssignReason,
  assignMutation,
}: {
  leadId: string;
  lead: Lead;
  router: { refresh: () => void };
  conflictMessage: string | null;
  actionError: string | null;
  conversionFlow: BusinessFlowNode[] | null;
  isClosed: boolean;
  canManageLeads: boolean;
  canResolveDuplicates: boolean;
  invalidateLead: () => void;
  ownerOptions: SelectOption[];
  pendingOwnerId: string;
  setPendingOwnerId: Dispatch<SetStateAction<string>>;
  assignReason: string;
  setAssignReason: Dispatch<SetStateAction<string>>;
  assignMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
    <div className="flex flex-col gap-6 py-4">
      {conflictMessage && (
        <ConflictBanner
          message={conflictMessage}
          onReload={() => router.refresh()}
        />
      )}
      {actionError && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {actionError}
        </p>
      )}
      {lead.recordStatus === "converted" && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-3">
          <p className="text-sm text-success">
            This Lead has been converted. It is now read-only.
          </p>
          {conversionFlow && (
            <RelatedBusinessFlow title="Sales flow" nodes={conversionFlow} />
          )}
        </div>
      )}
      {lead.recordStatus === "archived" && (
        <p className="rounded-[var(--radius-control)] border border-border-strong bg-canvas-strong px-3 py-2 text-sm text-text-secondary">
          This Lead is archived and read-only.
        </p>
      )}

      <LeadTagsPanel leadId={leadId} canManage={canManageLeads && !isClosed} />

      <LeadDuplicatesWorkspacePanel
        lead={lead}
        canResolve={canResolveDuplicates}
        hideWhenEmpty
        onMerged={invalidateLead}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PropertyList
          title="Contact"
          items={[
            { label: "Email", value: lead.email },
            { label: "Phone", value: lead.phone },
            { label: "Mobile", value: lead.mobile },
            { label: "City", value: lead.city },
            {
              label: "Country",
              value: countryName(lead.countryCode),
            },
          ]}
        />
        <PropertyList
          title="Company and interest"
          items={[
            { label: "Company", value: lead.companyName },
            { label: "Job title", value: lead.jobTitle },
            { label: "Industry", value: lead.industry },
            {
              label: "Product interest",
              value: lead.productInterest,
            },
            {
              label: "Estimated value",
              value:
                lead.estimatedValue !== null && Number(lead.estimatedValue) > 0
                  ? money(lead.currencyCode, lead.estimatedValue)
                  : null,
            },
          ]}
        />
      </div>

      {!isClosed && canManageLeads && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Assignment</p>
          <p className="text-xs text-text-muted">
            You can assign to people in your reporting scope who are eligible
            for this lead.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Owner"
              size="compact"
              options={ownerOptions}
              selectedKey={pendingOwnerId || lead.ownerUserId || "unassigned"}
              onSelectionChange={(key) => setPendingOwnerId(String(key ?? ""))}
              className="min-w-[220px]"
            />
            <TextField
              label="Reason (optional)"
              size="compact"
              value={assignReason}
              onChange={setAssignReason}
              className="min-w-[220px]"
            />
            <Button
              variant="secondary"
              size="compact"
              onPress={() => assignMutation.mutate()}
              isLoading={assignMutation.isPending}
            >
              <UserPlus className="size-4" aria-hidden="true" />
              Assign
            </Button>
          </div>
        </div>
      )}
      {isClosed && (
        <p className="flex items-center gap-1.5 text-sm text-text-muted">
          <Ban className="size-4" aria-hidden="true" />
          Assignment and stage changes are unavailable for a {
            lead.recordStatus
          }{" "}
          Lead.
        </p>
      )}
    </div>
  );
}
