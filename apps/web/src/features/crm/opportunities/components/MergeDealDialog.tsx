"use client";

// Merge another open deal of the same company into this one (CRM plan 5.4). Its activities, notes, files, messages, products, contacts,
// tags, followers and quotations move here; for each field both deals fill in differently, choose which value stays (blank fields here
// are filled from the other deal). The other deal is closed as a lost duplicate of this one.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, Select } from "@vercentlabs/design-system";

import { formatDate, formatMoney } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, getOpportunity, listOpportunities, type Opportunity } from "../api/opportunities-api";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";

class MergeError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(MergeError, "body");
const mergeDeals = (input: { keepId: string; duplicateId: string; choices: Record<string, "keep" | "duplicate"> }) =>
  request<{ keptOpportunityId: string; filledFields: string[] }>("/api/crm/opportunities/merge", { method: "POST", json: input });

const FIELDS: Array<{ key: keyof Opportunity & string; label: string; show?: (deal: Opportunity) => string | null }> = [
  { key: "name", label: "Name" },
  { key: "amount", label: "Estimated value", show: (deal) => (deal.amount ? formatMoney(deal.currencyCode ?? undefined, deal.amount) : null) },
  { key: "expectedCloseDate", label: "Close date", show: (deal) => (deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : null) },
  { key: "priority", label: "Priority" },
  { key: "productInterest", label: "Product interest" },
  { key: "description", label: "Description" },
  { key: "nextStep", label: "Next step" },
];

export function MergeDealDialog({ isOpen, onOpenChange, opportunity, onDone }: { isOpen: boolean; onOpenChange: (open: boolean) => void; opportunity: Opportunity; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const candidates = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", "merge-candidates", opportunity.id),
    queryFn: () => listOpportunities({ accountId: opportunity.accountId ?? undefined, status: "open", limit: 50 }).then((result) => result.rows.filter((row) => row.id !== opportunity.id)),
    enabled: Boolean(opportunity.accountId),
  });
  const [otherId, setOtherId] = useState("");
  const other = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity", otherId), queryFn: () => getOpportunity(otherId), enabled: Boolean(otherId) });
  const [choices, setChoices] = useState<Record<string, "keep" | "duplicate">>({});
  const merge = useMutation({ mutationFn: () => mergeDeals({ keepId: opportunity.id, duplicateId: otherId, choices }), onSuccess: () => { onDone(); onOpenChange(false); } });
  const shown = (deal: Opportunity, field: (typeof FIELDS)[number]) => (field.show ? field.show(deal) : deal[field.key] === null || deal[field.key] === undefined || deal[field.key] === "" ? null : String(deal[field.key]));
  const differing = other.data ? FIELDS.filter((field) => shown(other.data!, field) !== null && shown(opportunity, field) !== null && shown(other.data!, field) !== shown(opportunity, field)) : [];
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Merge another deal into ${opportunity.code}`} size="lg"
      description="Its work, products, contacts, tags, followers and quotations move here, and it is closed as a lost duplicate of this deal. Blank fields here are filled from it.">
      <div className="flex flex-col gap-4">
        {merge.isError && <p role="alert" className="text-sm text-danger">{errorMessage(merge.error, "The deals could not be merged.")}</p>}
        {candidates.data && candidates.data.length === 0 ? <p className="text-sm text-text-secondary">This company has no other open deal.</p> : (
          <Select label="Deal to merge in" isRequired selectedKey={otherId || null} onSelectionChange={(key) => { setOtherId(String(key)); setChoices({}); }}
            isDisabled={candidates.isLoading} options={(candidates.data ?? []).map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }))} />
        )}
        {other.data && differing.length > 0 && (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Both deals fill these in differently: which stays?</legend>
            {differing.map((field) => (
              <Select key={field.key} label={field.label} selectedKey={choices[field.key] ?? "keep"} onSelectionChange={(key) => setChoices((current) => ({ ...current, [field.key]: String(key) as "keep" | "duplicate" }))}
                options={[{ value: "keep", label: `This deal: ${shown(opportunity, field)}` }, { value: "duplicate", label: `${other.data!.code}: ${shown(other.data!, field)}` }]} />
            ))}
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" isLoading={merge.isPending} isDisabled={!otherId} onPress={() => merge.mutate()}>Merge into this deal</Button>
        </div>
      </div>
    </Dialog>
  );
}
