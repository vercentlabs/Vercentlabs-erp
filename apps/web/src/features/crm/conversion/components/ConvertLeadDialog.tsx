"use client";

// Convert a lead in one compact flow: lead summary and checks → account →
// contact → opportunity → confirm → result. Nothing is written until the
// final Convert, which is one request: the server creates or links every
// record and stamps the lead in one transaction, or changes nothing.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button, Checkbox, Dialog, Radio, RadioGroup, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  ConversionApiError, convertLead, errorMessage, getConversionPreview,
  type ConversionAccountMatch, type ConversionContactMatch, type LeadConversion, type LeadConversionInput, type LeadConversionPreview,
} from "../api/conversion-api";

const NEW = "__new__";
const NO_TEAM = "__none__";
const STEPS = ["Lead", "Account", "Contact", "Opportunity", "Confirm"] as const;
const PRIORITIES = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }];

type Options = { users: Array<{ id: string; name: string }>; teams: Array<{ id: string; name: string }>; currencies: string[]; baseCurrency: string };

export function ConvertLeadDialog({ isOpen, onOpenChange, leadId, options, onConverted }: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  options: Options;
  onConverted: (conversion: LeadConversion) => void;
}) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Convert lead" description="Turn this lead into its account, contact and opportunity. The lead is kept as a read-only record." size="lg">
      {isOpen && <ConversionFlow leadId={leadId} options={options} onClose={() => onOpenChange(false)} onConverted={onConverted} />}
    </Dialog>
  );
}

function ConversionFlow({ leadId, options, onClose, onConverted }: { leadId: string; options: Options; onClose: () => void; onConverted: (conversion: LeadConversion) => void }) {
  const workspace = useWorkspaceContext();
  const [finished, setFinished] = useState<LeadConversion | null>(null);
  const [accountChoice, setAccountChoice] = useState<string | null>(null);
  // The contacts and deals are matched against the account chosen in step 2.
  const matchAccountId = accountChoice && accountChoice !== NEW ? accountChoice : null;
  const preview = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "lead", leadId, "conversion-preview", matchAccountId),
    queryFn: () => getConversionPreview(leadId, matchAccountId),
    placeholderData: keepPreviousData,
    enabled: !finished,
  });
  if (finished) return <ConversionResult conversion={finished} onClose={onClose} title="Lead converted successfully" />;
  if (preview.isLoading || !preview.data) {
    return preview.isError ? <Banner tone="danger" message={errorMessage(preview.error)} /> : <LoadingState label="Checking the lead, accounts and contacts" rows={4} />;
  }
  const data = preview.data;
  if (data.conversion) return <ConversionResult conversion={data.conversion} onClose={onClose} title="This lead was already converted" />;
  if (data.blocked) return <Banner tone="danger" message={data.blocked.message} />;
  if (!data.defaults) return <Banner tone="danger" message="This lead cannot be converted." />;
  return (
    <ConversionForm
      leadId={leadId} preview={data} options={options} isRefreshing={preview.isFetching}
      accountChoice={accountChoice ?? (data.defaults.account.mode === "existing" ? data.defaults.account.id : NEW)}
      onAccountChoice={setAccountChoice} onClose={onClose} onConverted={(conversion) => { setFinished(conversion); onConverted(conversion); }}
    />
  );
}

function ConversionForm({ leadId, preview, options, isRefreshing, accountChoice, onAccountChoice, onClose, onConverted }: {
  leadId: string; preview: LeadConversionPreview; options: Options; isRefreshing: boolean; accountChoice: string;
  onAccountChoice: (choice: string) => void; onClose: () => void; onConverted: (conversion: LeadConversion) => void;
}) {
  const defaults = preview.defaults!;
  const lead = preview.lead;
  const can = preview.capabilities;
  const [step, setStep] = useState(0);
  // One key for this conversion: a double-click or a retry returns the first result.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [overrideReason, setOverrideReason] = useState("");
  const [duplicateReason, setDuplicateReason] = useState("");

  const newAccountDefaults = defaults.account.mode === "new" ? defaults.account : { name: lead.company ?? "", website: lead.website ?? "", industry: lead.industry ?? "", ownerUserId: lead.ownerUserId };
  const [account, setAccount] = useState({ name: newAccountDefaults.name, legalName: "", website: newAccountDefaults.website, industry: newAccountDefaults.industry, ownerUserId: newAccountDefaults.ownerUserId ?? "" });
  const [acknowledgeAccounts, setAcknowledgeAccounts] = useState(false);

  const newContactDefaults = defaults.contact.mode === "new" ? defaults.contact
    : { firstName: lead.firstName ?? "", lastName: lead.lastName ?? "", email: lead.email ?? "", mobile: lead.mobile ?? "", phone: lead.phone ?? "", jobTitle: lead.jobTitle ?? "", ownerUserId: lead.ownerUserId };
  const [contactChoice, setContactChoice] = useState<string>(defaults.contact.mode === "existing" ? defaults.contact.id : NEW);
  const [contact, setContact] = useState({ ...newContactDefaults, ownerUserId: newContactDefaults.ownerUserId ?? "" });
  const [contactUpdates, setContactUpdates] = useState<Record<string, "lead" | "existing">>({});
  const [acknowledgeContacts, setAcknowledgeContacts] = useState(false);

  const [opportunity, setOpportunity] = useState({
    ...defaults.opportunity,
    amount: defaults.opportunity.amount === null ? "" : String(defaults.opportunity.amount),
    currencyCode: defaults.opportunity.currencyCode ?? options.baseCurrency,
    teamId: defaults.opportunity.teamId ?? NO_TEAM,
    stageId: defaults.opportunity.stageId ?? "",
    expectedCloseDate: defaults.opportunity.expectedCloseDate ?? "",
    ownerUserId: defaults.opportunity.ownerUserId ?? "",
  });
  const [nameTouched, setNameTouched] = useState(false);
  const [acknowledgeDeals, setAcknowledgeDeals] = useState(false);
  const [openWork, setOpenWork] = useState<"move" | "keep">(defaults.openWork);

  const accountMatches = preview.accountMatches ?? [];
  const contactMatches = preview.contactMatches ?? [];
  const visibleAccounts = accountMatches.filter((match) => match.canOpen);
  const hiddenStrongAccount = accountMatches.some((match) => !match.canOpen);
  const visibleContacts = contactMatches.filter((match) => match.canOpen);
  const hiddenStrongContact = contactMatches.some((match) => !match.canOpen);
  const chosenAccount = visibleAccounts.find((match) => match.id === accountChoice) ?? null;
  const chosenContact = visibleContacts.find((match) => match.id === contactChoice) ?? null;
  const strongAccounts = accountMatches.filter((match) => match.strength === "exact");
  const strongContacts = contactMatches.filter((match) => match.strength === "exact");
  const similarDeals = (preview.opportunityMatches ?? []).filter((deal) => deal.similar && (!chosenAccount || deal.accountId === chosenAccount.id));
  const accountName = chosenAccount?.name ?? account.name;
  // The suggested name follows the account until the salesperson edits it.
  const opportunityName = nameTouched ? opportunity.name : `${accountName || "New account"} — ${(opportunity.productInterest || "New opportunity").slice(0, 80)}`;
  const userOptions = options.users.map((user) => ({ value: user.id, label: user.name }));
  const ownerLocked = !can.changeOwner;

  const needsOverride = Boolean(preview.requiresOverride);
  const newAccountBlockedByStrong = accountChoice === NEW && strongAccounts.length > 0;
  const newContactBlockedByStrong = contactChoice === NEW && strongContacts.length > 0;

  // What still stops each step, in words.
  const problems: string[][] = [
    needsOverride ? (can.overrideQualification ? (overrideReason.trim() ? [] : ["Give the reason for converting with missing qualification."]) : ["Qualify this lead before converting it, or ask a manager."]) : [],
    accountChoice === NEW
      ? [
        !can.createAccount && "You cannot create accounts while converting. Choose an existing account.",
        !account.name.trim() && "Enter the company name for the new account.",
        newAccountBlockedByStrong && !can.overrideDuplicate && "A matching account already exists. Use it, or ask a manager.",
        newAccountBlockedByStrong && can.overrideDuplicate && !duplicateReason.trim() && "Give the reason for creating a new account despite the match.",
        !newAccountBlockedByStrong && accountMatches.length > 0 && !acknowledgeAccounts && "Confirm that none of the matching accounts is this company.",
      ].filter((entry): entry is string => Boolean(entry))
      : [!can.useExisting && "You cannot use an existing account while converting."].filter((entry): entry is string => Boolean(entry)),
    contactChoice === NEW
      ? [
        !can.createContact && "You cannot create contacts while converting. Choose an existing contact.",
        !(contact.firstName.trim() || contact.lastName.trim()) && "Enter the contact's name.",
        !(contact.email.trim() || contact.mobile.trim() || contact.phone.trim()) && "Enter an email, mobile or phone for the contact.",
        newContactBlockedByStrong && !can.overrideDuplicate && "This person is already a contact. Use the existing contact.",
        newContactBlockedByStrong && can.overrideDuplicate && !duplicateReason.trim() && "Give the reason for creating a new contact despite the match.",
        !newContactBlockedByStrong && contactMatches.length > 0 && !acknowledgeContacts && "Confirm that none of the matching contacts is this person.",
      ].filter((entry): entry is string => Boolean(entry))
      : [!can.useExisting && "You cannot use an existing contact while converting."].filter((entry): entry is string => Boolean(entry)),
    [
      !opportunityName.trim() && "Enter the opportunity name.",
      !opportunity.expectedCloseDate && "Choose the expected close date.",
      opportunity.amount.trim() !== "" && (!Number.isFinite(Number(opportunity.amount)) || Number(opportunity.amount) < 0) && "Enter an estimated value of zero or more.",
      similarDeals.length > 0 && !acknowledgeDeals && "Confirm this is a separate deal from the open opportunity on the account.",
    ].filter((entry): entry is string => Boolean(entry)),
    [],
  ];

  const input = (): LeadConversionInput => ({
    idempotencyKey,
    account: accountChoice === NEW
      ? { mode: "new", name: account.name.trim(), legalName: account.legalName.trim() || undefined, website: account.website.trim(), industry: account.industry.trim(), ownerUserId: account.ownerUserId || undefined, acknowledgeMatches: acknowledgeAccounts }
      : { mode: "existing", id: accountChoice },
    contact: contactChoice === NEW
      ? { mode: "new", firstName: contact.firstName.trim(), lastName: contact.lastName.trim(), email: contact.email.trim(), mobile: contact.mobile.trim(), phone: contact.phone.trim(), jobTitle: contact.jobTitle.trim(), ownerUserId: contact.ownerUserId || undefined, acknowledgeMatches: acknowledgeContacts }
      : { mode: "existing", id: contactChoice, updates: contactUpdates },
    opportunity: {
      name: opportunityName.trim(), ownerUserId: opportunity.ownerUserId || undefined, teamId: opportunity.teamId === NO_TEAM ? null : opportunity.teamId,
      stageId: opportunity.stageId || undefined, amount: opportunity.amount.trim(), currencyCode: opportunity.currencyCode, expectedCloseDate: opportunity.expectedCloseDate,
      productInterest: opportunity.productInterest.trim(), description: opportunity.description.trim(), priority: opportunity.priority, acknowledgeMatches: acknowledgeDeals,
    },
    openWork,
    ...(needsOverride ? { overrideReason: overrideReason.trim() } : {}),
    ...(duplicateReason.trim() ? { duplicateReason: duplicateReason.trim() } : {}),
  });

  const convert = useMutation({ mutationFn: () => convertLead(leadId, input()), onSuccess: onConverted });

  const blocking = problems[step];
  const firstProblemStep = problems.findIndex((list) => list.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-1 text-xs" aria-label="Conversion steps">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button type="button" disabled={index > step && problems.slice(0, index).some((list) => list.length > 0)} onClick={() => setStep(index)}
              className={`rounded-full px-2.5 py-1 font-medium ${index === step ? "bg-brand text-text-inverse" : "bg-surface-muted text-text-secondary hover:text-text disabled:opacity-50"}`}
              aria-current={index === step ? "step" : undefined}>
              {index + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <LeadSummary preview={preview} />
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Ready to convert?</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {(preview.checks ?? []).map((check) => (
                <li key={check.key} className="flex items-start gap-2">
                  {check.met ? <Check className="mt-0.5 size-4 text-success" aria-hidden="true" /> : <X className={`mt-0.5 size-4 ${check.overridable ? "text-danger" : "text-warning"}`} aria-hidden="true" />}
                  <span><span className="font-medium">{check.label}</span>{check.value ? <span className="text-text-secondary"> · {check.value}</span> : null}</span>
                </li>
              ))}
            </ul>
          </section>
          {needsOverride && (can.overrideQualification
            ? <TextArea label="Reason for converting with missing qualification" isRequired description={`Missing: ${(preview.missing ?? []).map((entry) => entry.label).join(", ")}. Recorded in the lead's history.`} value={overrideReason} onChange={setOverrideReason} />
            : <Banner tone="warning" message={`This lead cannot be converted yet. Missing: ${(preview.missing ?? []).map((entry) => entry.label).join(", ")}. Qualify it first, or ask a manager to convert it.`} />)}
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <RadioGroup label="Account" description="The company the opportunity is for. An existing account is never changed by the conversion." value={accountChoice}
            onChange={(value) => { onAccountChoice(value); setContactUpdates({}); }}>
            {visibleAccounts.map((match) => (
              <Radio key={match.id} value={match.id} isDisabled={!can.useExisting}><AccountMatchCard match={match} /></Radio>
            ))}
            <Radio value={NEW} isDisabled={!can.createAccount}>Create a new account</Radio>
          </RadioGroup>
          {hiddenStrongAccount && <Banner tone="warning" message="An account you cannot open matches this company. Ask a manager before creating a new one." />}
          {accountChoice === NEW && (
            <div className="grid gap-3 rounded-[var(--radius-card)] border border-border p-3 sm:grid-cols-2">
              <TextField label="Company name" isRequired value={account.name} onChange={(name) => setAccount({ ...account, name })} />
              <TextField label="Legal name" description="Optional." value={account.legalName} onChange={(legalName) => setAccount({ ...account, legalName })} />
              <TextField label="Website" value={account.website} onChange={(website) => setAccount({ ...account, website })} />
              <TextField label="Industry" value={account.industry} onChange={(industry) => setAccount({ ...account, industry })} />
              <Select label="Account owner" isRequired isDisabled={ownerLocked} description={ownerLocked ? "The lead owner." : undefined} selectedKey={account.ownerUserId}
                onSelectionChange={(key) => setAccount({ ...account, ownerUserId: String(key) })} options={userOptions} />
              {accountMatches.length > 0 && (newAccountBlockedByStrong
                ? (can.overrideDuplicate && <TextField label="Why is this a different company?" isRequired value={duplicateReason} onChange={setDuplicateReason} />)
                : <Checkbox isSelected={acknowledgeAccounts} onChange={setAcknowledgeAccounts}>None of the accounts above is this company</Checkbox>)}
            </div>
          )}
          {!account.name.trim() && !lead.company && accountChoice === NEW && <p className="text-sm text-text-secondary">The lead has no company. Choose an existing account or enter the new account&apos;s name.</p>}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          {isRefreshing && <p className="text-xs text-text-muted">Checking contacts at the chosen account…</p>}
          <RadioGroup label="Contact" description="The person at the account. An existing contact is reused, never duplicated." value={contactChoice} onChange={(value) => { setContactChoice(value); setContactUpdates({}); }}>
            {visibleContacts.map((match) => (
              <Radio key={match.id} value={match.id} isDisabled={!can.useExisting}><ContactMatchCard match={match} /></Radio>
            ))}
            <Radio value={NEW} isDisabled={!can.createContact}>Create a new contact</Radio>
          </RadioGroup>
          {hiddenStrongContact && <Banner tone="warning" message="A contact you cannot open has this email or phone. Ask a manager before creating a new one." />}
          {chosenContact && (chosenContact.conflicts ?? []).length > 0 && (
            <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-3">
              <h3 className="text-sm font-semibold">The lead and the contact differ</h3>
              {(chosenContact.conflicts ?? []).map((conflict) => (
                <RadioGroup key={conflict.field} label={conflict.label} value={contactUpdates[conflict.field] ?? "existing"} orientation="horizontal"
                  onChange={(value) => setContactUpdates({ ...contactUpdates, [conflict.field]: value as "lead" | "existing" })}>
                  <Radio value="existing">Keep existing: {conflict.existing || "not set"}</Radio>
                  <Radio value="lead">Use lead value: {conflict.lead}</Radio>
                </RadioGroup>
              ))}
            </section>
          )}
          {contactChoice === NEW && (
            <div className="grid gap-3 rounded-[var(--radius-card)] border border-border p-3 sm:grid-cols-2">
              <TextField label="First name" isRequired value={contact.firstName} onChange={(firstName) => setContact({ ...contact, firstName })} />
              <TextField label="Last name" value={contact.lastName} onChange={(lastName) => setContact({ ...contact, lastName })} />
              <TextField label="Email" type="email" value={contact.email} onChange={(email) => setContact({ ...contact, email })} />
              <TextField label="Mobile" value={contact.mobile} onChange={(mobile) => setContact({ ...contact, mobile })} />
              <TextField label="Phone" value={contact.phone} onChange={(phone) => setContact({ ...contact, phone })} />
              <TextField label="Job title" value={contact.jobTitle} onChange={(jobTitle) => setContact({ ...contact, jobTitle })} />
              <Select label="Contact owner" isRequired isDisabled={ownerLocked} description={ownerLocked ? "The lead owner." : undefined} selectedKey={contact.ownerUserId}
                onSelectionChange={(key) => setContact({ ...contact, ownerUserId: String(key) })} options={userOptions} />
              {contactMatches.length > 0 && (newContactBlockedByStrong
                ? (can.overrideDuplicate && <TextField label="Why is this a different person?" isRequired value={duplicateReason} onChange={setDuplicateReason} />)
                : <Checkbox isSelected={acknowledgeContacts} onChange={setAcknowledgeContacts}>None of the contacts above is this person</Checkbox>)}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField className="sm:col-span-2" label="Opportunity name" isRequired value={opportunityName} onChange={(name) => { setNameTouched(true); setOpportunity({ ...opportunity, name }); }} />
            <Select label="Owner" isRequired isDisabled={ownerLocked} description={ownerLocked ? "The lead owner." : undefined} selectedKey={opportunity.ownerUserId}
              onSelectionChange={(key) => setOpportunity({ ...opportunity, ownerUserId: String(key) })} options={userOptions} />
            <Select label="Team" selectedKey={opportunity.teamId} onSelectionChange={(key) => setOpportunity({ ...opportunity, teamId: String(key) })}
              options={[{ value: NO_TEAM, label: "No team" }, ...options.teams.map((team) => ({ value: team.id, label: team.name }))]} />
            <Select label="Sales stage" isRequired selectedKey={opportunity.stageId} onSelectionChange={(key) => setOpportunity({ ...opportunity, stageId: String(key) })}
              options={(preview.stages ?? []).map((stage) => ({ value: stage.id, label: `${stage.name} (${stage.probability}%)` }))} />
            <DateInput label="Expected close date" isRequired value={opportunity.expectedCloseDate} onChange={(expectedCloseDate) => setOpportunity({ ...opportunity, expectedCloseDate })} />
            <TextField label="Estimated value" inputMode="decimal" description="Optional. Zero or more." value={opportunity.amount} onChange={(amount) => setOpportunity({ ...opportunity, amount })} />
            <Select label="Currency" selectedKey={opportunity.currencyCode} onSelectionChange={(key) => setOpportunity({ ...opportunity, currencyCode: String(key) })}
              options={[...new Set([opportunity.currencyCode, ...options.currencies])].filter(Boolean).map((code) => ({ value: code, label: code }))} />
            <TextField label="Product / service interest" value={opportunity.productInterest} onChange={(productInterest) => setOpportunity({ ...opportunity, productInterest })} />
            <Select label="Priority" selectedKey={opportunity.priority} onSelectionChange={(key) => setOpportunity({ ...opportunity, priority: String(key) })} options={PRIORITIES} />
            <TextArea className="sm:col-span-2" label="Description / requirement" value={opportunity.description} onChange={(description) => setOpportunity({ ...opportunity, description })} />
          </div>
          <p className="text-sm text-text-secondary">Source: <span className="font-medium text-text">{lead.sourceName ?? "None"}</span> (from the lead, kept for attribution). The budget, decision authority, timeframe and qualification notes are copied to the opportunity&apos;s notes.</p>
          {similarDeals.length > 0 && (
            <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-warning/40 bg-warning-soft p-3">
              <h3 className="text-sm font-semibold">This account already has a similar open opportunity</h3>
              <ul className="text-sm">
                {similarDeals.map((deal) => (
                  <li key={deal.id}><a className="font-medium text-brand underline" href={`/crm/opportunities/${deal.id}`} target="_blank" rel="noreferrer">{deal.code} {deal.name}</a>
                    <span className="text-text-secondary"> · {deal.stageName ?? "Open"} · {formatMoney(deal.currencyCode ?? undefined, deal.amount)}{deal.ownerName ? ` · ${deal.ownerName}` : ""}</span></li>
                ))}
              </ul>
              <Checkbox isSelected={acknowledgeDeals} onChange={setAcknowledgeDeals}>This is a separate deal</Checkbox>
            </section>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Summary label="Account" value={chosenAccount ? `Use existing: ${chosenAccount.name}` : `Create new: ${account.name}`} />
            <Summary label="Contact" value={chosenContact ? `Use existing: ${chosenContact.name}${Object.values(contactUpdates).includes("lead") ? " (update from the lead)" : ""}` : `Create new: ${[contact.firstName, contact.lastName].filter(Boolean).join(" ")}`} />
            <Summary label="Opportunity" value={opportunityName} />
            <Summary label="Stage" value={(preview.stages ?? []).find((stage) => stage.id === opportunity.stageId)?.name ?? "First stage"} />
            <Summary label="Estimated value" value={opportunity.amount.trim() ? formatMoney(opportunity.currencyCode, Number(opportunity.amount)) : "Not set"} />
            <Summary label="Expected close" value={opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : "Not set"} />
            <Summary label="Owner" value={options.users.find((user) => user.id === opportunity.ownerUserId)?.name ?? "Lead owner"} />
            {needsOverride && <Summary label="Qualification override" value={overrideReason} />}
            {duplicateReason.trim() && <Summary label="Duplicate override" value={duplicateReason} />}
          </dl>
          {((preview.openWork?.tasks ?? 0) + (preview.openWork?.followUps ?? 0)) > 0 && (
            <RadioGroup label={`Open work on the lead: ${preview.openWork!.tasks} task(s), ${preview.openWork!.followUps} follow-up(s)`} value={openWork} onChange={(value) => setOpenWork(value as "move" | "keep")}>
              <Radio value="move">Move it to the opportunity (recommended)</Radio>
              <Radio value="keep">Keep it on the lead</Radio>
            </RadioGroup>
          )}
          <p className="text-sm text-text-secondary">Completed activities, notes and files stay on the lead. The opportunity links back to it.</p>
          {convert.isError && (
            <Banner tone="danger" message={`Conversion failed. No records were created and the lead is unchanged. ${errorMessage(convert.error)}`}
              detail={convert.error instanceof ConversionApiError && /DUPLICATE/.test(convert.error.code ?? "") ? "Go back to the account, contact or opportunity step to review the matches." : undefined} />
          )}
          {firstProblemStep >= 0 && firstProblemStep < 4 && (
            <Banner tone="warning" message={`Step ${firstProblemStep + 1} (${STEPS[firstProblemStep]}) needs attention: ${problems[firstProblemStep][0]}`} />
          )}
        </div>
      )}

      {step < 4 && blocking.length > 0 && <p className="text-sm text-text-secondary">{blocking[0]}</p>}

      <div className="flex justify-between gap-2 border-t border-border pt-3">
        <Button variant="secondary" onPress={step === 0 ? onClose : () => setStep(step - 1)}>{step === 0 ? "Cancel" : "Back"}</Button>
        {step < 4
          ? <Button variant="primary" isDisabled={blocking.length > 0} onPress={() => setStep(step + 1)}>Next</Button>
          : <Button variant="primary" isLoading={convert.isPending} isDisabled={firstProblemStep >= 0} onPress={() => convert.mutate()}>Convert lead</Button>}
      </div>
    </div>
  );
}

function LeadSummary({ preview }: { preview: LeadConversionPreview }) {
  const lead = preview.lead;
  const rows = useMemo(() => [
    ["Lead", `${lead.name ?? lead.company ?? lead.code} (${lead.code})`],
    ["Company", lead.company ?? "Not on the lead"],
    ["Email / phone", [lead.email, lead.mobile ?? lead.phone].filter(Boolean).join(" · ") || "Not on the lead"],
    ["Owner", lead.ownerName ?? "Unassigned"],
    ["Source", lead.sourceName ?? "None"],
    ["Product interest", lead.productInterest ?? "Not captured"],
    ["Estimated value", lead.estimatedValue === null ? "Not set" : formatMoney(lead.currencyCode ?? undefined, lead.estimatedValue)],
    ["Rating", lead.rating ? lead.rating[0].toUpperCase() + lead.rating.slice(1) : "Not rated"],
    ["Qualification", `${lead.status === "qualified" ? "Qualified" : "Not qualified"} · score ${lead.qualification.score}/100${lead.qualifiedByName ? ` · by ${lead.qualifiedByName}` : ""}`],
  ], [lead]);
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-[var(--radius-card)] border border-border bg-surface-muted p-3 text-sm sm:grid-cols-3">
      {rows.map(([label, value]) => <Summary key={label} label={label} value={value} />)}
    </dl>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 flex-col"><dt className="text-text-secondary">{label}</dt><dd className="break-words font-medium">{value}</dd></div>;
}

function MatchStrength({ strength }: { strength: string }) {
  return strength === "exact" ? <StatusBadge tone="warning">Strong match</StatusBadge> : <StatusBadge tone="neutral">Possible match</StatusBadge>;
}

function AccountMatchCard({ match }: { match: ConversionAccountMatch }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2"><span className="font-medium">Use existing: {match.name}</span><MatchStrength strength={match.strength} />{match.isCustomer && <StatusBadge tone="success">Customer</StatusBadge>}</span>
      <span className="text-xs text-text-secondary">{[match.code, match.website, match.city, match.ownerName && `Owner: ${match.ownerName}`].filter(Boolean).join(" · ")}</span>
      {(match.differences ?? []).map((difference) => (
        <span key={difference.field} className="text-xs text-text-muted">{difference.label}: account has &quot;{difference.existing}&quot;, lead says &quot;{difference.lead}&quot; (the account is not changed)</span>
      ))}
    </span>
  );
}

function ContactMatchCard({ match }: { match: ConversionContactMatch }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2"><span className="font-medium">Use existing: {match.name}</span><MatchStrength strength={match.strength} /></span>
      <span className="text-xs text-text-secondary">{[match.jobTitle, match.email, match.mobile, match.accountName, match.ownerName && `Owner: ${match.ownerName}`].filter(Boolean).join(" · ")}</span>
    </span>
  );
}

function Banner({ tone, message, detail }: { tone: "danger" | "warning"; message: string; detail?: string }) {
  const style = tone === "danger" ? "border-danger-emphasis/30 bg-danger-soft text-danger" : "border-warning/40 bg-warning-soft text-text";
  return (
    <div role="alert" className={`rounded-[var(--radius-control)] border px-3 py-2 text-sm ${style}`}>
      <p>{message}</p>
      {detail && <p className="mt-1 text-text-secondary">{detail}</p>}
    </div>
  );
}

// After a conversion: what was created or linked, and where to continue.
function ConversionResult({ conversion, onClose, title }: { conversion: LeadConversion; onClose: () => void; title: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2"><Check className="size-5 text-success" aria-hidden="true" /><h3 className="text-base font-semibold">{title}</h3></div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Summary label={`Account (${conversion.accountDecision === "existing" ? "existing" : "new"})`} value={conversion.accountName ?? "—"} />
        <Summary label={`Contact (${conversion.contactDecision === "existing" ? "existing" : "new"})`} value={conversion.contactName ?? "—"} />
        <Summary label="Opportunity" value={`${conversion.opportunityCode ?? ""} ${conversion.opportunityName ?? ""}`.trim()} />
        <Summary label="Converted by" value={`${conversion.convertedByName ?? "—"} · ${formatDate(conversion.convertedAt)}`} />
        {conversion.movedWorkCount > 0 && <Summary label="Open work moved" value={`${conversion.movedWorkCount} task(s) and follow-up(s)`} />}
      </dl>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onPress={onClose}>Close</Button>
        {conversion.partyId && <Button variant="secondary" onPress={() => router.push(`/crm/accounts/${conversion.partyId}`)}>Open account</Button>}
        {conversion.opportunityId && <Button variant="primary" onPress={() => router.push(`/crm/opportunities/${conversion.opportunityId}`)}>Open opportunity</Button>}
      </div>
    </div>
  );
}
