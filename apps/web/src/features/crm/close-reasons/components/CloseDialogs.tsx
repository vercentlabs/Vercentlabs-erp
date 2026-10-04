"use client";

// How a deal ends: Mark won, Mark lost, Reopen, and correcting a close
// reason. Status says what happened and the reason says why; the deal stays
// in the stage it closed in. Each dialog collects what its server operation
// needs; the server checks the reason's own rules again.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import {
  errorMessage, listOpportunities, markOpportunityLost, markOpportunityWon, reopenOpportunity,
  type Opportunity, type OpportunityOptions,
} from "@/features/crm/opportunities/api/opportunities-api";
import { ErrorBanner } from "@/features/crm/opportunities/opportunity-format";
import { listOpportunityQuotations } from "@/features/crm/quotations/api/quotations-api";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatMoney } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { correctOpportunityCloseReason } from "../api/close-reasons-api";

const NONE = "";
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

type BaseProps = { isOpen: boolean; onOpenChange: (open: boolean) => void; options: OpportunityOptions; opportunity: Opportunity; onDone: () => void };

function Actions({ onCancel, onConfirm, label, isLoading, isDisabled, danger }: {
  onCancel: () => void; onConfirm: () => void; label: string; isLoading: boolean; isDisabled?: boolean; danger?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onPress={onCancel}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} onPress={onConfirm} isLoading={isLoading} isDisabled={isDisabled}>{label}</Button>
    </div>
  );
}

// Closing a deal never removes its open tasks silently: they are kept or cancelled.
function OpenWorkChoice({ count, value, onChange, won, kind = "task" }: { count: number; value: string; onChange: (value: string) => void; won?: boolean; kind?: "task" | "follow-up" }) {
  if (!count) return null;
  return (
    <Select label={`${count} open ${count === 1 ? kind : `${kind}s`} on this opportunity`} selectedKey={value} onSelectionChange={(key) => onChange(String(key))}
      description={won ? (kind === "task" ? "A won deal may still need work, such as the implementation handoff." : "A handoff or customer call can stay.") : kind === "follow-up" ? "Keep one if the customer may come back later." : undefined}
      options={[{ value: "keep", label: "Keep them open" }, { value: "cancel", label: "Cancel them" }]} />
  );
}

// Winning a deal: why, for how much, when, and with which quotation.
export function MarkWonDialog({ isOpen, onOpenChange, options, opportunity, onDone, winningQuotationId }: BaseProps & { winningQuotationId?: string }) {
  const workspace = useWorkspaceContext();
  const [reasonId, setReasonId] = useState(NONE);
  const [closeDate, setCloseDate] = useState(today);
  const [finalValue, setFinalValue] = useState(String(opportunity.amount || ""));
  const [quotationId, setQuotationId] = useState(winningQuotationId ?? NONE);
  const [competitorName, setCompetitorName] = useState("");
  const [notes, setNotes] = useState("");
  const [openTasks, setOpenTasks] = useState("keep");
  const [openFollowUps, setOpenFollowUps] = useState("keep");
  const [error, setError] = useState<string | null>(null);
  const reason = options.wonReasons.find((entry) => entry.id === reasonId);
  const quotations = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunity", opportunity.id, "quotations", "winning"),
    queryFn: () => listOpportunityQuotations(opportunity.id).then((result) => result.quotations.filter((entry) => entry.status !== "cancelled")),
    enabled: isOpen && opportunity.quotationCount > 0,
  });
  const mutation = useMutation({
    mutationFn: () => markOpportunityWon(opportunity.id, {
      reasonId, actualCloseDate: closeDate, finalValue, winningQuotationId: quotationId || undefined, notes: notes.trim() || undefined,
      competitorName: competitorName.trim() || undefined, expectedUpdatedAt: opportunity.updatedAt,
      openTasks: openTasks as "keep" | "cancel", openFollowUps: openFollowUps as "keep" | "cancel",
    }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  // Choosing the winning quotation offers its total as the final value.
  const chooseQuotation = (id: string) => {
    setQuotationId(id);
    const chosen = quotations.data?.find((entry) => entry.id === id);
    if (chosen?.total) setFinalValue(String(chosen.total));
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Mark opportunity won"
      description={`${opportunity.name} · ${opportunity.stageName} · estimated ${formatMoney(opportunity.currencyCode ?? undefined, opportunity.amount)}. The probability becomes 100% and the deal stays in ${opportunity.stageName} as its final stage.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={`Final deal value (${opportunity.currencyCode ?? ""})`} isRequired inputMode="decimal" description="The estimate is kept alongside it." value={finalValue} onChange={setFinalValue} />
          <DateInput label="Actual close date" isRequired value={closeDate} onChange={setCloseDate} />
          <Select className="sm:col-span-2" label="Won reason" isRequired selectedKey={reasonId} onSelectionChange={(key) => setReasonId(String(key ?? NONE))}
            options={options.wonReasons.map((entry) => ({ value: entry.id, label: entry.name }))} />
        </div>
        {(quotations.data?.length ?? 0) > 0 && (
          <Select label="Winning quotation" selectedKey={quotationId} onSelectionChange={(key) => chooseQuotation(String(key ?? NONE))}
            options={[{ value: NONE, label: "None chosen" }, ...(quotations.data ?? []).map((entry) => ({
              value: entry.id, label: `${entry.number}${entry.total !== null ? ` · ${formatMoney(entry.currencyCode ?? undefined, entry.total)}` : ""} · ${entry.statusLabel}`,
            }))]} />
        )}
        {reason?.capturesCompetitor && <TextField label="Competitor" isRequired={reason.requiresCompetitor} description="Who the deal was won against." value={competitorName} onChange={setCompetitorName} />}
        <TextArea label="Close notes" isRequired={reason?.requiresNotes} description={reason?.requiresNotes ? "Explain the reason." : "Internal. Never shown on a quotation, order or invoice."} value={notes} onChange={setNotes} />
        <OpenWorkChoice count={opportunity.openTaskCount} value={openTasks} onChange={setOpenTasks} won />
        <OpenWorkChoice count={opportunity.openFollowUpCount} value={openFollowUps} onChange={setOpenFollowUps} won kind="follow-up" />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Mark won" isLoading={mutation.isPending}
          isDisabled={!reasonId || !closeDate || finalValue.trim() === "" || (Boolean(reason?.requiresNotes) && !notes.trim()) || (Boolean(reason?.requiresCompetitor) && !competitorName.trim())} />
      </div>
    </Dialog>
  );
}

// Losing always has a reason. The reason decides what else is asked: an
// explanation, the competitor, the original of a duplicate, a later follow-up.
export function MarkLostDialog({ isOpen, onOpenChange, options, opportunity, onDone }: BaseProps) {
  const [reasonId, setReasonId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [competitorName, setCompetitorName] = useState("");
  const [closeDate, setCloseDate] = useState(today);
  const [openTasks, setOpenTasks] = useState("cancel");
  const [openFollowUps, setOpenFollowUps] = useState("cancel");
  const [revisit, setRevisit] = useState(false);
  const [revisitDate, setRevisitDate] = useState(() => inDays(180));
  const [originalSearch, setOriginalSearch] = useState("");
  const [original, setOriginal] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reason = options.lostReasons.find((entry) => entry.id === reasonId);
  const originals = useQuery({
    queryKey: ["close-duplicate-search", originalSearch],
    queryFn: () => listOpportunities({ search: originalSearch.trim(), limit: 8 }),
    enabled: Boolean(reason?.linksDuplicate) && originalSearch.trim().length >= 2 && !original,
  });
  const mutation = useMutation({
    mutationFn: () => markOpportunityLost(opportunity.id, {
      reasonId, actualCloseDate: closeDate, notes: notes.trim() || undefined, competitorName: competitorName.trim() || undefined, expectedUpdatedAt: opportunity.updatedAt,
      duplicateOfOpportunityId: reason?.linksDuplicate && original ? original.id : undefined,
      followUp: reason?.offersFollowUp && revisit && revisitDate ? { date: revisitDate } : undefined,
      openTasks: openTasks as "keep" | "cancel", openFollowUps: openFollowUps as "keep" | "cancel",
    }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Mark opportunity lost"
      description={`${opportunity.name} · final stage ${opportunity.stageName} · ${formatMoney(opportunity.currencyCode ?? undefined, opportunity.amount)}. The value and stage are kept for reporting; the probability becomes 0%. It can be reopened later.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Lost reason" isRequired selectedKey={reasonId} onSelectionChange={(key) => setReasonId(String(key ?? NONE))}
            options={options.lostReasons.map((entry) => ({ value: entry.id, label: entry.name }))} />
          <DateInput label="Actual close date" isRequired value={closeDate} onChange={setCloseDate} />
        </div>
        {reason?.capturesCompetitor && (
          <TextField label="Competitor" isRequired={reason.requiresCompetitor} description={reason.requiresCompetitor ? "Who the customer chose." : "Optional. Who won the deal."} value={competitorName} onChange={setCompetitorName} />
        )}
        {reason?.linksDuplicate && (
          <div className="flex flex-col gap-2">
            {original ? (
              <p className="text-sm">Duplicate of <span className="font-medium">{original.label}</span> <Button variant="ghost" size="compact" onPress={() => setOriginal(null)}>Change</Button></p>
            ) : (
              <>
                <TextField label="Original opportunity" description="Optional. Search by name or number." value={originalSearch} onChange={setOriginalSearch} />
                {(originals.data?.rows ?? []).filter((row) => row.id !== opportunity.id).map((row) => (
                  <Button key={row.id} variant="ghost" size="compact" onPress={() => setOriginal({ id: row.id, label: `${row.code} ${row.name}` })}>{row.code} · {row.name}</Button>
                ))}
              </>
            )}
          </div>
        )}
        <TextArea label="Close notes" isRequired={reason?.requiresNotes} description={reason?.requiresNotes ? "Explain the reason." : "What happened? Internal: never shown on customer documents."} value={notes} onChange={setNotes} />
        {reason?.offersFollowUp && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
            <Checkbox isSelected={revisit} onChange={setRevisit}>Schedule a follow-up to revisit this deal later</Checkbox>
            {revisit && <DateInput label="Follow up on" isRequired value={revisitDate} onChange={setRevisitDate} />}
          </div>
        )}
        <OpenWorkChoice count={opportunity.openTaskCount} value={openTasks} onChange={setOpenTasks} />
        <OpenWorkChoice count={opportunity.openFollowUpCount} value={openFollowUps} onChange={setOpenFollowUps} kind="follow-up" />
        <Actions danger onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Mark lost" isLoading={mutation.isPending}
          isDisabled={!reasonId || !closeDate || (Boolean(reason?.requiresNotes) && !notes.trim()) || (Boolean(reason?.requiresCompetitor) && !competitorName.trim()) || (revisit && !revisitDate)} />
      </div>
    </Dialog>
  );
}

export function ReopenOpportunityDialog({ isOpen, onOpenChange, options, opportunity, onDone }: BaseProps) {
  const [reason, setReason] = useState("");
  const [stageId, setStageId] = useState(NONE);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => reopenOpportunity(opportunity.id, { reason, stageId: stageId || undefined }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Reopen opportunity"
      description={opportunity.status === "won"
        ? "A won deal can be reopened only while it has no sales order or accepted quotation. Otherwise, create a new opportunity."
        : "The lost reason, close date, competitor and notes stay in the close history."}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextArea label="Why is it being reopened?" isRequired value={reason} onChange={setReason} />
        <Select label="Reopen at stage" selectedKey={stageId} onSelectionChange={(key) => setStageId(String(key ?? NONE))}
          options={[{ value: NONE, label: `The stage it closed in (${opportunity.stageName})` }, ...options.stages.map((stage) => ({ value: stage.id, label: stage.name }))]} />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Reopen" isLoading={mutation.isPending} isDisabled={!reason.trim()} />
      </div>
    </Dialog>
  );
}

// A wrong reason on a closed deal is corrected, not edited: with permission, and with a reason that is kept.
export function CorrectCloseReasonDialog({ isOpen, onOpenChange, options, opportunity, onDone }: BaseProps) {
  const reasons = opportunity.status === "won" ? options.wonReasons : options.lostReasons;
  const [reasonId, setReasonId] = useState(opportunity.closeReasonId ?? NONE);
  const [notes, setNotes] = useState(opportunity.closeNotes ?? "");
  const [competitorName, setCompetitorName] = useState(opportunity.competitorName ?? "");
  const [correctionReason, setCorrectionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reason = reasons.find((entry) => entry.id === reasonId);
  const mutation = useMutation({
    mutationFn: () => correctOpportunityCloseReason(opportunity.id, { reasonId, notes, competitorName, correctionReason: correctionReason.trim() }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Correct the ${opportunity.status} reason`} description="The earlier reason and this correction are both kept in the opportunity's history.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label={opportunity.status === "won" ? "Won reason" : "Lost reason"} isRequired selectedKey={reasonId} onSelectionChange={(key) => setReasonId(String(key ?? NONE))}
          options={reasons.map((entry) => ({ value: entry.id, label: entry.name }))} />
        {reason?.capturesCompetitor && <TextField label="Competitor" isRequired={reason.requiresCompetitor} value={competitorName} onChange={setCompetitorName} />}
        <TextArea label="Close notes" isRequired={reason?.requiresNotes} value={notes} onChange={setNotes} />
        <TextField label="Why is the reason being corrected?" isRequired value={correctionReason} onChange={setCorrectionReason} />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Save correction" isLoading={mutation.isPending}
          isDisabled={!reasonId || !correctionReason.trim() || (Boolean(reason?.requiresNotes) && !notes.trim()) || (Boolean(reason?.requiresCompetitor) && !competitorName.trim())} />
      </div>
    </Dialog>
  );
}
