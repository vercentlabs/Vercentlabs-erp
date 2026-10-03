"use client";

// Structured qualification: need, budget, authority and timeframe, with the
// Qualify and Disqualify decisions. Answers can be saved at any time; a
// decision changes the lead's status.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime, formatMoney } from "@/shared/format/human";

import { errorMessage, qualifyLead, saveLeadQualification, type Lead, type LeadOptions } from "../api/leads-api";
import { ErrorBanner, RATING_OPTIONS, TRI_STATE_OPTIONS } from "../lead-format";

const NONE = "";

function answersOf(lead: Lead) {
  return {
    needIdentified: lead.needIdentified,
    budgetStatus: lead.budgetStatus,
    budgetAmount: lead.budgetAmount === null ? "" : String(lead.budgetAmount),
    decisionAuthority: lead.decisionAuthority,
    purchaseTimeframe: lead.purchaseTimeframe ?? NONE,
    productInterest: lead.productInterest ?? "",
    estimatedValue: lead.estimatedValue ? String(lead.estimatedValue) : "",
    qualificationNotes: lead.qualificationNotes ?? "",
    rating: lead.rating,
  };
}

export function QualificationPanel({ lead, options, onChanged, onDisqualify }: {
  lead: Lead;
  options: LeadOptions;
  onChanged: () => void;
  onDisqualify: () => void;
}) {
  const [answers, setAnswers] = useState(answersOf(lead));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const can = options.capabilities;
  const editable = can.edit && lead.status !== "converted" && !lead.archivedAt;
  const set = <K extends keyof typeof answers>(key: K) => (value: (typeof answers)[K]) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const payload = () => ({ ...answers, budgetAmount: answers.budgetStatus === "known" ? answers.budgetAmount : null, purchaseTimeframe: answers.purchaseTimeframe || null });
  const handlers = {
    onSuccess: () => { setError(null); setSaved(true); onChanged(); },
    onError: (failure: unknown) => setError(errorMessage(failure)),
  };
  const save = useMutation({ mutationFn: () => saveLeadQualification(lead.id, payload()), ...handlers });
  const qualify = useMutation({ mutationFn: () => qualifyLead(lead.id, payload()), ...handlers });

  const currency = lead.currencyCode ?? options.baseCurrency;

  return (
    <section className="flex flex-col gap-4">
      <ErrorBanner message={error} />
      {lead.status === "qualified" && (
        <p className="rounded-[var(--radius-control)] border border-success-emphasis/20 bg-success-soft px-3 py-2 text-sm text-success">
          Qualified on {formatDateTime(lead.qualifiedAt)}. Convert the lead to create its account, contact and opportunity.
        </p>
      )}
      {lead.status === "disqualified" && (
        <p className="rounded-[var(--radius-control)] border border-danger-emphasis/20 bg-danger-soft px-3 py-2 text-sm text-danger">
          Disqualified on {formatDateTime(lead.disqualifiedAt)} — {options.disqualificationReasons.find((entry) => entry.code === lead.disqualificationReason)?.label ?? lead.disqualificationReason}
          {lead.disqualificationNotes ? `. ${lead.disqualificationNotes}` : ""}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Need identified" isDisabled={!editable} selectedKey={answers.needIdentified} onSelectionChange={(key) => set("needIdentified")(String(key) as Lead["needIdentified"])} options={TRI_STATE_OPTIONS} />
        <Select label="Decision authority" description="Is this person able to decide?" isDisabled={!editable} selectedKey={answers.decisionAuthority}
          onSelectionChange={(key) => set("decisionAuthority")(String(key) as Lead["decisionAuthority"])} options={TRI_STATE_OPTIONS} />
        <Select label="Budget" isDisabled={!editable} selectedKey={answers.budgetStatus} onSelectionChange={(key) => set("budgetStatus")(String(key) as Lead["budgetStatus"])}
          options={[{ value: "known", label: "Known" }, { value: "unknown", label: "Unknown" }]} />
        <TextField label={`Budget amount (${currency})`} inputMode="decimal" isDisabled={!editable || answers.budgetStatus !== "known"} value={answers.budgetStatus === "known" ? answers.budgetAmount : ""} onChange={set("budgetAmount")} />
        <Select label="Purchase timeframe" isDisabled={!editable} selectedKey={answers.purchaseTimeframe} onSelectionChange={(key) => set("purchaseTimeframe")(String(key ?? NONE))}
          options={[{ value: NONE, label: "Not set" }, ...options.purchaseTimeframes.map((entry) => ({ value: entry.code, label: entry.label }))]} />
        <Select label="Rating" isDisabled={!editable} selectedKey={answers.rating} onSelectionChange={(key) => set("rating")(String(key) as Lead["rating"])} options={RATING_OPTIONS} />
        <TextField label={`Expected value (${currency})`} inputMode="decimal" isDisabled={!editable} value={answers.estimatedValue} onChange={set("estimatedValue")}
          description={lead.estimatedValue ? formatMoney(currency, lead.estimatedValue) : undefined} />
        <TextField label="Product / service interest" isDisabled={!editable} value={answers.productInterest} onChange={set("productInterest")} />
        <TextArea label="Qualification notes" className="sm:col-span-2" isDisabled={!editable} value={answers.qualificationNotes} onChange={set("qualificationNotes")} />
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onPress={() => save.mutate()} isLoading={save.isPending}>Save answers</Button>
          {lead.status === "open" && can.qualify && <Button variant="primary" onPress={() => qualify.mutate()} isLoading={qualify.isPending}>Qualify lead</Button>}
          {(lead.status === "open" || lead.status === "qualified") && can.disqualify && <Button variant="danger" onPress={onDisqualify}>Disqualify lead</Button>}
          {saved && <span role="status" className="text-sm text-text-secondary">Saved</span>}
        </div>
      )}
    </section>
  );
}
