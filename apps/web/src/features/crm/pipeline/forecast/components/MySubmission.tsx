"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  StatusBadge,
  TextArea,
  TextField,
} from "@vercentlabs/design-system";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { formatMoney, humanize } from "@/shared/format/human";
import {
  submitGovernedForecast,
  type ForecastWorkspace,
} from "../api/forecast-api";
import { SUBMISSION_TONE, SUBMISSION_LABEL, num } from "./forecast-format";

export function MySubmission({
  data,
  onSaved,
}: {
  data: ForecastWorkspace;
  onSaved: () => void;
}) {
  const workspace = useWorkspaceContext();
  const mine = data.owners.find(
    (owner) => owner.ownerUserId === workspace.userId,
  );
  const submission = mine?.submission ?? null;
  const [commit, setCommit] = useState(
    String(
      submission ? num(submission.commitAmount) : (mine?.figures.commit ?? 0),
    ),
  );
  const [bestCase, setBestCase] = useState(
    String(
      submission
        ? num(submission.bestCaseAmount)
        : (mine?.figures.bestCase ?? 0),
    ),
  );
  const [notes, setNotes] = useState(submission?.notes ?? "");
  const mutation = useMutation({
    mutationFn: () =>
      submitGovernedForecast({
        periodId: data.period.id,
        commitAmount: Number(commit),
        bestCaseAmount: Number(bestCase),
        notes,
        expectedVersion: submission?.version,
      }),
    onSuccess: onSaved,
  });
  const currency = data.reportingCurrency;
  return (
    <section
      aria-label="My forecast"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">My forecast</h2>
        {submission ? (
          <StatusBadge tone={SUBMISSION_TONE[submission.status] ?? "neutral"}>
            {SUBMISSION_LABEL[submission.status] ?? humanize(submission.status)}
          </StatusBadge>
        ) : (
          <span className="text-xs text-text-muted">Not submitted yet</span>
        )}
      </div>
      <p className="text-sm text-text-secondary">
        {`From your deals closing in this period: commit ${formatMoney(currency, mine?.figures.commit ?? 0)}, best case ${formatMoney(currency, mine?.figures.bestCase ?? 0)}, pipeline ${formatMoney(currency, mine?.figures.pipeline ?? 0)}.`}
        {submission && num(submission.managerAdjustment) !== 0
          ? ` Your manager adjusted your commit by ${formatMoney(currency, submission.managerAdjustment)}: ${submission.adjustmentReason ?? ""}`
          : ""}
      </p>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <TextField
          label="Commit"
          type="number"
          inputMode="decimal"
          value={commit}
          onChange={setCommit}
          isRequired
        />
        <TextField
          label="Best case"
          type="number"
          inputMode="decimal"
          value={bestCase}
          onChange={setBestCase}
          isRequired
        />
        <TextArea label="Notes" value={notes} onChange={setNotes} rows={2} />
        {mutation.isError && (
          <p role="alert" className="text-sm text-danger sm:col-span-3">
            {(mutation.error as Error).message}
          </p>
        )}
        <div className="sm:col-span-3">
          <Button
            type="submit"
            variant="primary"
            isLoading={mutation.isPending}
          >
            {submission ? "Resubmit" : "Submit forecast"}
          </Button>
        </div>
      </form>
    </section>
  );
}
