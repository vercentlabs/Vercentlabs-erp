"use client";

// Convert a qualified lead: link or create the account, link or create the
// contact, and (optionally) create the opportunity. Matching accounts and
// contacts are shown before anything is created; the whole conversion
// succeeds or nothing changes.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Radio, RadioGroup, Select, TextField } from "@vercentlabs/design-system";

import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { LeadApiError, convertLead, errorMessage, getLeadConversionPreview, type ConversionMatch, type LeadConversionPreview, type LeadOptions } from "../api/leads-api";
import { ErrorBanner } from "../lead-format";

const CREATE = "__create__";
const DEFAULT_STAGE = "__default__";

type Conversion = { partyId: string; contactId: string | null; opportunityId: string | null };

export function ConvertLeadDialog({ isOpen, onOpenChange, leadId, options, onConverted }: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  options: LeadOptions;
  onConverted: (conversion: Conversion) => void;
}) {
  const workspace = useWorkspaceContext();
  const previewQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "lead", leadId, "conversion-preview"),
    queryFn: () => getLeadConversionPreview(leadId),
    enabled: isOpen,
  });
  const preview = previewQuery.data;

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Convert lead" description="Create the account, contact and opportunity this lead becomes. The lead is kept for reporting." size="lg">
      {previewQuery.isLoading || !preview ? (
        previewQuery.isError ? <ErrorBanner message={errorMessage(previewQuery.error)} /> : <LoadingState label="Checking for existing accounts and contacts" rows={4} />
      ) : !preview.canConvert ? (
        <ErrorBanner message={preview.blockedReason ?? "This lead cannot be converted."} />
      ) : (
        // Re-created whenever the preview is reloaded, so it starts from the latest matches.
        <ConversionForm
          key={previewQuery.dataUpdatedAt}
          leadId={leadId}
          preview={preview}
          options={options}
          onCancel={() => onOpenChange(false)}
          onMatchesChanged={() => void previewQuery.refetch()}
          onConverted={(conversion) => { onConverted(conversion); onOpenChange(false); }}
        />
      )}
    </Dialog>
  );
}

function ConversionForm({ leadId, preview, options, onCancel, onMatchesChanged, onConverted }: {
  leadId: string;
  preview: LeadConversionPreview;
  options: LeadOptions;
  onCancel: () => void;
  onMatchesChanged: () => void;
  onConverted: (conversion: Conversion) => void;
}) {
  // Start from the suggested values; an existing match is preselected so the
  // safe choice (link, don't duplicate) is the default.
  const [account, setAccount] = useState(preview.accountMatches[0]?.id ?? CREATE);
  const [accountName, setAccountName] = useState(preview.defaults.accountName ?? "");
  const [confirmNewAccount, setConfirmNewAccount] = useState(false);
  const [contact, setContact] = useState(preview.contactMatches[0]?.id ?? CREATE);
  const [confirmNewContact, setConfirmNewContact] = useState(false);
  const [createOpportunity, setCreateOpportunity] = useState(true);
  const [opportunityName, setOpportunityName] = useState(preview.defaults.opportunityName);
  const [amount, setAmount] = useState(preview.defaults.amount ? String(preview.defaults.amount) : "");
  const [productInterest, setProductInterest] = useState(preview.lead.productInterest ?? "");
  // Each new record starts with the lead owner and can be given to someone else.
  const [ownerUserId, setOwnerUserId] = useState(preview.defaults.opportunityOwnerUserId ?? options.currentUserId);
  const [accountOwnerUserId, setAccountOwnerUserId] = useState(preview.defaults.accountOwnerUserId ?? options.currentUserId);
  const [contactOwnerUserId, setContactOwnerUserId] = useState(preview.defaults.contactOwnerUserId ?? options.currentUserId);
  const ownerOptions = options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }));
  const [stageId, setStageId] = useState(DEFAULT_STAGE);
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => convertLead(leadId, {
      account: account === CREATE ? { name: accountName, ownerUserId: accountOwnerUserId, allowDuplicate: confirmNewAccount } : { id: account },
      contact: contact === CREATE ? { ownerUserId: contactOwnerUserId, allowDuplicate: confirmNewContact } : { id: contact },
      opportunity: createOpportunity
        ? { name: opportunityName, amount, productInterest, ownerUserId, expectedCloseDate: expectedCloseDate || null, ...(stageId !== DEFAULT_STAGE ? { stageId } : {}) }
        : { create: false },
    }),
    onSuccess: onConverted,
    onError: (failure) => {
      setError(errorMessage(failure));
      // A match appeared since the dialog opened: reload so it is offered.
      if (failure instanceof LeadApiError && failure.code?.startsWith("CRM_LEAD_CONVERSION_")) onMatchesChanged();
    },
  });

  // Open deals on the chosen account: worth a look before creating another one.
  const similarOpportunities = account === CREATE ? [] : preview.opportunityMatches.filter((match) => match.partyId === account);
  const accountNeedsConfirmation = account === CREATE && preview.accountMatches.length > 0 && !confirmNewAccount;
  const contactNeedsConfirmation = contact === CREATE && preview.canCreateContact && preview.contactMatches.length > 0 && !confirmNewContact;
  const incomplete = (account === CREATE && !accountName.trim()) || (createOpportunity && !opportunityName.trim());

  return (
        <div className="flex flex-col gap-5">
          <ErrorBanner message={error} />

          <RadioGroup label="Account" description="The company this lead belongs to." value={account} onChange={setAccount}>
            {preview.accountMatches.map((match) => (
              <Radio key={match.id} value={match.id}>Use existing account: {matchLabel(match)}</Radio>
            ))}
            <Radio value={CREATE}>Create a new account</Radio>
          </RadioGroup>
          {account === CREATE && (
            <div className="flex flex-col gap-3 pl-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Account name" isRequired value={accountName} onChange={setAccountName} />
                <Select label="Account owner" isRequired selectedKey={accountOwnerUserId} onSelectionChange={(key) => setAccountOwnerUserId(String(key))} options={ownerOptions} />
              </div>
              {preview.accountMatches.length > 0 && (
                <Checkbox isSelected={confirmNewAccount} onChange={setConfirmNewAccount}>
                  This is a different company from the existing {preview.accountMatches.length === 1 ? "account" : "accounts"} above
                </Checkbox>
              )}
            </div>
          )}

          <RadioGroup label="Contact" description="The person at that company." value={contact} onChange={setContact}>
            {preview.contactMatches.map((match) => (
              <Radio key={match.id} value={match.id}>Use existing contact: {matchLabel(match)}</Radio>
            ))}
            <Radio value={CREATE}>
              {preview.canCreateContact ? `Create a new contact from ${preview.lead.fullName}` : "No contact (this lead has no name with an email or phone)"}
            </Radio>
          </RadioGroup>
          {contact === CREATE && preview.canCreateContact && (
            <div className="flex flex-col gap-3 pl-6">
              <Select label="Contact owner" isRequired className="sm:max-w-xs" selectedKey={contactOwnerUserId} onSelectionChange={(key) => setContactOwnerUserId(String(key))} options={ownerOptions} />
              {preview.contactMatches.length > 0 && (
                <Checkbox isSelected={confirmNewContact} onChange={setConfirmNewContact}>
                  This is a different person from the existing {preview.contactMatches.length === 1 ? "contact" : "contacts"} above
                </Checkbox>
              )}
            </div>
          )}

          <div className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-border p-4">
            <Checkbox isSelected={createOpportunity} onChange={setCreateOpportunity}>Create an opportunity</Checkbox>
            {createOpportunity && similarOpportunities.length > 0 && (
              <div role="note" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm">
                <p className="font-medium">This account already has {similarOpportunities.length === 1 ? "an open opportunity" : "open opportunities"}:</p>
                <ul className="list-disc pl-5">
                  {similarOpportunities.map((match) => (
                    <li key={match.id}>{[match.name, match.code, match.amount ? String(match.amount) : null, match.stageName].filter(Boolean).join(" · ")}</li>
                  ))}
                </ul>
                <p>You can still create a new one if this is a separate deal.</p>
              </div>
            )}
            {createOpportunity && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Opportunity name" isRequired className="sm:col-span-2" value={opportunityName} onChange={setOpportunityName} />
                <TextField label="Estimated value" inputMode="decimal" value={amount} onChange={setAmount} />
                <DateInput label="Expected close date" value={expectedCloseDate} onChange={setExpectedCloseDate} />
                <TextField label="Product / service interest" className="sm:col-span-2" value={productInterest} onChange={setProductInterest} />
                <Select label="Opportunity owner" isRequired selectedKey={ownerUserId} onSelectionChange={(key) => setOwnerUserId(String(key))} options={ownerOptions} />
                <Select label="Sales stage" selectedKey={stageId} onSelectionChange={(key) => setStageId(String(key))}
                  options={[{ value: DEFAULT_STAGE, label: "First stage of the default pipeline" }, ...preview.stages.map((stage) => ({ value: stage.id, label: `${stage.pipelineName} — ${stage.name}` }))]} />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={onCancel}>Cancel</Button>
            <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={incomplete || accountNeedsConfirmation || contactNeedsConfirmation}>
              Convert lead
            </Button>
          </div>
        </div>
  );
}

function matchLabel(match: ConversionMatch) {
  return [match.name, match.code, match.accountName, match.email, match.phone].filter(Boolean).join(" · ");
}
