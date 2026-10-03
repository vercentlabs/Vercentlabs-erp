"use client";

// Lead qualification on screen: the compact summary at the top of the lead,
// the Qualification tab (answers, checklist, history) and the Qualify
// confirmation. Answers can be saved at any time; Qualify and Disqualify are
// decisions that change the lead's status.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleHelp, X } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  LeadApiError, errorMessage, getLeadQualification, qualifyLead, saveLeadQualification,
  type Lead, type LeadOptions, type LeadQualificationStatus, type LeadQualificationView,
} from "../api/leads-api";
import { ErrorBanner, RATING_OPTIONS, RatingBadge, leadName } from "../lead-format";

const NONE = "";
const STATUS_TONE: Record<LeadQualificationStatus, "neutral" | "info" | "success" | "danger"> = {
  not_started: "neutral", in_progress: "info", qualified: "success", disqualified: "danger",
};
const labelOf = (list: Array<{ code: string; label: string }>, code: string | null) => list.find((entry) => entry.code === code)?.label ?? "Unknown";
const ratingLabel = (rating: string) => RATING_OPTIONS.find((entry) => entry.value === rating)?.label ?? rating;

export function QualificationStatusBadge({ status, options }: { status: LeadQualificationStatus; options: LeadOptions }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{labelOf(options.qualificationStatuses, status)}</StatusBadge>;
}

function useQualification(leadId: string, version: string, enabled = true) {
  const workspace = useWorkspaceContext();
  return useQuery({
    // The lead's updatedAt is in the key, so any change to the lead reloads it.
    queryKey: scopedQueryKey(workspace, "crm", "lead", leadId, "qualification", version),
    queryFn: () => getLeadQualification(leadId),
    enabled,
  });
}

// ------------------------------------------------------------------ summary

type Mark = "yes" | "no" | "unknown";
function criteriaOf(lead: Lead, options: LeadOptions): Array<{ label: string; mark: Mark; value: string }> {
  const budgetRange = [lead.budgetMin, lead.budgetMax].filter((value): value is number => value !== null);
  const currency = lead.currencyCode ?? options.baseCurrency;
  return [
    { label: "Need", mark: lead.needStatus === "yes" ? "yes" : lead.needStatus === "no" ? "no" : "unknown", value: lead.needStatus === "yes" ? "Confirmed" : lead.needStatus === "no" ? "No need" : "Unknown" },
    {
      label: "Budget",
      mark: lead.budgetStatus === "confirmed" || lead.budgetStatus === "likely" ? "yes" : lead.budgetStatus === "no_budget" ? "no" : "unknown",
      value: `${labelOf(options.budgetStatuses, lead.budgetStatus)}${budgetRange.length ? ` · ${[...new Set(budgetRange)].map((amount) => formatMoney(currency, amount)).join(" – ")}` : ""}`,
    },
    {
      label: "Authority",
      mark: lead.authorityStatus === "decision_maker" || lead.authorityStatus === "influencer" ? "yes" : lead.authorityStatus === "no_authority" ? "no" : "unknown",
      value: `${labelOf(options.authorityStatuses, lead.authorityStatus)}${lead.authorityDetail ? ` · ${lead.authorityDetail}` : ""}`,
    },
    {
      label: "Timeline",
      mark: lead.purchaseTimeframe && lead.purchaseTimeframe !== "unknown" ? "yes" : "unknown",
      value: lead.purchaseTimeframe ? labelOf(options.purchaseTimeframes, lead.purchaseTimeframe) : "Unknown",
    },
  ];
}

function MarkIcon({ mark }: { mark: Mark }) {
  if (mark === "yes") return <Check className="size-4 shrink-0 text-success" aria-label="Confirmed" />;
  if (mark === "no") return <X className="size-4 shrink-0 text-danger" aria-label="No" />;
  return <CircleHelp className="size-4 shrink-0 text-text-muted" aria-label="Unknown" />;
}

// The lead's quality at a glance, shown above the tabs.
export function QualificationSummary({ lead, options }: { lead: Lead; options: LeadOptions }) {
  return (
    <section aria-label="Qualification summary" className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-2"><span className="text-text-secondary">Qualification</span><QualificationStatusBadge status={lead.qualificationStatus} options={options} /></span>
        <span className="flex items-center gap-2"><span className="text-text-secondary">Rating</span><RatingBadge rating={lead.rating} /></span>
        <span className="text-text-secondary">Score <span className="font-medium tabular-nums text-text">{lead.qualificationScore}</span> / 100</span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
        {criteriaOf(lead, options).map((criterion) => (
          <div key={criterion.label} className="flex min-w-0 items-center gap-2">
            <MarkIcon mark={criterion.mark} />
            <dt className="shrink-0 text-text-secondary">{criterion.label}</dt>
            <dd className="truncate font-medium" title={criterion.value}>{criterion.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Checklist({ qualification }: { qualification: LeadQualificationView }) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {qualification.checklist.map((item) => (
        <li key={item.key} className="flex items-start gap-2">
          {item.done ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" /> : <span className="mt-0.5 size-4 shrink-0 rounded-sm border border-border-strong" aria-label="Not done" />}
          <span className={item.done ? "" : "text-text-secondary"}>
            {item.label}{item.required && <span className="text-text-muted"> · required</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ the tab

function answersOf(lead: Lead) {
  return {
    needStatus: lead.needStatus as string,
    businessNeed: lead.businessNeed ?? "",
    budgetStatus: lead.budgetStatus as string,
    budgetMin: lead.budgetMin === null ? "" : String(lead.budgetMin),
    budgetMax: lead.budgetMax === null ? "" : String(lead.budgetMax),
    authorityStatus: lead.authorityStatus as string,
    authorityDetail: lead.authorityDetail ?? "",
    purchaseTimeframe: lead.purchaseTimeframe ?? NONE,
    productInterest: lead.productInterest ?? "",
    estimatedValue: lead.estimatedValue ? String(lead.estimatedValue) : "",
    qualificationNotes: lead.qualificationNotes ?? "",
    rating: lead.rating as string,
  };
}

export function QualificationPanel({ lead, options, onChanged, onQualify, onDisqualify, onScheduleFollowUp }: {
  lead: Lead;
  options: LeadOptions;
  onChanged: () => void;
  onQualify: () => void;
  onDisqualify: () => void;
  onScheduleFollowUp: () => void;
}) {
  const [answers, setAnswers] = useState(answersOf(lead));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const query = useQualification(lead.id, lead.updatedAt);
  const qualification = query.data;

  const can = options.capabilities;
  const working = can.edit && lead.status !== "converted" && !lead.archivedAt;
  // The answers behind a decision are part of its record: reopen to change them.
  const editable = working && lead.status === "open";
  const set = <K extends keyof typeof answers>(key: K) => (value: (typeof answers)[K]) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const payload = () => (editable ? { ...answers, purchaseTimeframe: answers.purchaseTimeframe || null } : { rating: answers.rating });
  const save = useMutation({
    mutationFn: (then?: () => void) => saveLeadQualification(lead.id, payload()).then(() => then),
    onSuccess: (then) => { setError(null); setSaved(true); onChanged(); then?.(); },
    onError: (failure: unknown) => setError(errorMessage(failure)),
  });
  const currency = lead.currencyCode ?? options.baseCurrency;
  const codeOptions = (list: Array<{ code: string; label: string }>) => list.map((entry) => ({ value: entry.code, label: entry.label }));

  return (
    <section className="flex flex-col gap-4">
      <ErrorBanner message={error} />
      {lead.qualificationStatus === "qualified" && (
        <p className="rounded-[var(--radius-control)] border border-success-emphasis/20 bg-success-soft px-3 py-2 text-sm text-success">
          Qualified on {formatDateTime(lead.qualifiedAt)}{lead.qualifiedByName ? ` by ${lead.qualifiedByName}` : ""}.
          {lead.qualificationOverrideReason ? ` Qualified with missing information: ${lead.qualificationOverrideReason}` : ""}
          {lead.status === "qualified" ? " Convert the lead to create its account, contact and opportunity." : ""}
        </p>
      )}
      {lead.status === "disqualified" && (
        <p className="rounded-[var(--radius-control)] border border-danger-emphasis/20 bg-danger-soft px-3 py-2 text-sm text-danger">
          Disqualified on {formatDateTime(lead.disqualifiedAt)}{lead.disqualifiedByName ? ` by ${lead.disqualifiedByName}` : ""} — {labelOf(options.disqualificationReasons, lead.disqualificationReason)}
          {lead.disqualificationNotes ? `. ${lead.disqualificationNotes}` : ""} Reopen the lead to qualify it again.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4 sm:grid-cols-2">
          <Select label="Need identified" isDisabled={!editable} selectedKey={answers.needStatus} onSelectionChange={(key) => set("needStatus")(String(key))} options={codeOptions(options.needStatuses)} />
          <Select label="Decision authority" description="Can this person decide, or influence the decision?" isDisabled={!editable} selectedKey={answers.authorityStatus}
            onSelectionChange={(key) => set("authorityStatus")(String(key))} options={codeOptions(options.authorityStatuses)} />
          <TextArea label="Business problem / requirement" className="sm:col-span-2" isDisabled={!editable} value={answers.businessNeed} onChange={set("businessNeed")} />
          <TextField label="Who decides" description="For example: Operations Head + CFO" className="sm:col-span-2" isDisabled={!editable} value={answers.authorityDetail} onChange={set("authorityDetail")} />
          <Select label="Budget" isDisabled={!editable} selectedKey={answers.budgetStatus} onSelectionChange={(key) => set("budgetStatus")(String(key))} options={codeOptions(options.budgetStatuses)} />
          <div className="grid grid-cols-2 gap-2">
            <TextField label={`Budget from (${currency})`} inputMode="decimal" isDisabled={!editable} value={answers.budgetMin} onChange={set("budgetMin")} />
            <TextField label={`Budget to (${currency})`} inputMode="decimal" isDisabled={!editable} value={answers.budgetMax} onChange={set("budgetMax")} />
          </div>
          <Select label="Purchase timeframe" isDisabled={!editable} selectedKey={answers.purchaseTimeframe} onSelectionChange={(key) => set("purchaseTimeframe")(String(key ?? NONE))}
            options={[{ value: NONE, label: "Not set" }, ...codeOptions(options.purchaseTimeframes)]} />
          <Select label="Rating" isDisabled={!working} selectedKey={answers.rating} onSelectionChange={(key) => set("rating")(String(key))} options={RATING_OPTIONS}
            description={qualification ? `The answers suggest ${ratingLabel(qualification.suggestedRating)} (score ${qualification.score}). You decide.` : undefined} />
          <TextField label={`Estimated deal value (${currency})`} inputMode="decimal" isDisabled={!editable} value={answers.estimatedValue} onChange={set("estimatedValue")} />
          <TextField label="Product / service interest" isDisabled={!editable} value={answers.productInterest} onChange={set("productInterest")} />
          <TextArea label="Qualification notes" className="sm:col-span-2" isDisabled={!editable} value={answers.qualificationNotes} onChange={set("qualificationNotes")} />
        </div>

        <aside className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <h3 className="text-sm font-semibold">Qualification checklist</h3>
            {query.isLoading ? <LoadingState label="Loading checklist" rows={3} /> : !qualification ? <ErrorBanner message="Could not load the checklist." /> : (
              <>
                <Checklist qualification={qualification} />
                {lead.status === "open" && qualification.missing.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
                    <p>Still needed to qualify: <span className="font-medium">{qualification.missing.map((entry) => entry.label).join(", ")}</span></p>
                    {working && <div><Button variant="secondary" size="compact" onPress={onScheduleFollowUp}>Schedule a follow-up or task</Button></div>}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {working && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onPress={() => save.mutate(undefined)} isLoading={save.isPending}>{editable ? "Save answers" : "Save rating"}</Button>
          {/* Saves what is on screen first, so the decision is made on these answers. */}
          {lead.status === "open" && can.qualify && <Button variant="primary" onPress={() => save.mutate(onQualify)} isDisabled={save.isPending}>Qualify lead</Button>}
          {(lead.status === "open" || lead.status === "qualified") && can.disqualify && <Button variant="danger" onPress={onDisqualify}>Disqualify lead</Button>}
          {saved && <span role="status" className="text-sm text-text-secondary">Saved</span>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Qualification history</h3>
        {query.isLoading ? <LoadingState label="Loading history" rows={2} />
          : !qualification || qualification.history.length === 0 ? <p className="text-sm text-text-secondary">Nothing yet. The history starts with the first answer you save.</p>
          : (
            <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
              {qualification.history.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
                  <span className="font-medium">{entry.summary}</span>
                  {entry.notes && <span className="text-text-secondary">{entry.notes}</span>}
                  <span className="text-xs text-text-muted">{formatDateTime(entry.changedAt)} · {entry.changedByName ?? "System"}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ qualify

// The Qualify confirmation: what is being qualified, what is still missing,
// and (for a manager) qualifying anyway with a reason. Qualifying normally
// continues straight into conversion.
export function QualifyLeadDialog({ isOpen, onOpenChange, lead, options, onQualified }: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  options: LeadOptions;
  onQualified: (convert: boolean) => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQualification(lead.id, lead.updatedAt, isOpen);
  const qualification = query.data;
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (convert: boolean) => qualifyLead(lead.id, override ? { override: true, overrideReason: reason } : {}).then(() => convert),
    onSuccess: (convert) => { setError(null); onOpenChange(false); onQualified(convert); },
    onError: (failure) => {
      setError(errorMessage(failure));
      // The requirements or the answers changed since the dialog opened.
      if (failure instanceof LeadApiError && failure.code === "CRM_LEAD_QUALIFICATION_INCOMPLETE")
        void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead", lead.id, "qualification") });
    },
  });
  const missing = qualification?.missing ?? [];
  const blocked = missing.length > 0 && !(override && reason.trim());
  const currency = lead.currencyCode ?? options.baseCurrency;
  const facts = [
    ["Company", lead.companyName],
    ["Contact", lead.fullName],
    ["Product interest", lead.productInterest],
    ["Estimated value", lead.estimatedValue ? formatMoney(currency, lead.estimatedValue) : null],
    ["Timeline", lead.purchaseTimeframe ? labelOf(options.purchaseTimeframes, lead.purchaseTimeframe) : null],
    ["Business need", lead.businessNeed],
  ] as const;

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Qualify lead" description={`${leadName(lead)} · ${lead.code}`} size="lg">
      {query.isLoading || !qualification ? (
        query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : <LoadingState label="Checking the qualification" rows={4} />
      ) : (
        <div className="flex flex-col gap-5">
          <ErrorBanner message={error} />
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-text-secondary">{label}</dt>
                <dd className="font-medium">{value || <span className="font-normal text-text-muted">Not set</span>}</dd>
              </div>
            ))}
            <div className="flex flex-col"><dt className="text-text-secondary">Rating</dt><dd><RatingBadge rating={lead.rating} /></dd></div>
            <div className="flex flex-col"><dt className="text-text-secondary">Score</dt><dd className="font-medium tabular-nums">{qualification.score} / 100</dd></div>
          </dl>
          <Checklist qualification={qualification} />

          {missing.length > 0 && (
            <div role="alert" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm">
              <p className="font-medium">Lead cannot be qualified yet.</p>
              <div>
                <p>Missing:</p>
                <ul className="list-disc pl-5">{missing.map((entry) => <li key={entry.key}>{entry.label}</li>)}</ul>
              </div>
              {qualification.canOverride ? (
                <>
                  <Checkbox isSelected={override} onChange={setOverride}>Qualify anyway</Checkbox>
                  {override && <TextArea label="Why is this lead being qualified with missing information?" isRequired value={reason} onChange={setReason} />}
                </>
              ) : (
                <p>Add the missing answers on the Qualification tab, or ask a manager to qualify it.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="outline" onPress={() => mutation.mutate(false)} isDisabled={blocked || mutation.isPending}>Qualify only</Button>
            {options.capabilities.convert
              ? <Button variant="primary" onPress={() => mutation.mutate(true)} isLoading={mutation.isPending} isDisabled={blocked}>Qualify and convert</Button>
              : <Badge tone="info">Someone with the Convert permission creates the opportunity</Badge>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
