"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  ErrorState,
  Select,
  StatusBadge,
  TextField,
} from "@vercentlabs/design-system";
import { LoadingState } from "@/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDate, humanize } from "@/shared/format/human";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import {
  createForecastPeriod,
  CrmForecastApiError,
  listForecastPeriods,
} from "../api/forecast-api";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Waiting for review",
  approved: "Approved",
  rejected: "Sent back",
  superseded: "Replaced",
  planned: "Not started",
  open: "Open",
  frozen: "Frozen",
  closed: "Closed",
};
const statusLabel = (value: string) => STATUS_LABEL[value] ?? humanize(value);
const rangeLabel = (start: string, end: string) =>
  formatDate(start) + " to " + formatDate(end);

// F025 — every forecast amount opens the exact deals behind it: open
// pipeline/weighted by expected close date, best case and commit by
// forecast category, won by the date it was won. The list's total always
// equals the figure (same owner, dates and category predicates).

export function PeriodsDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [periodType, setPeriodType] = useState("quarter");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const dateOrderError =
    periodStart && periodEnd && periodEnd < periodStart
      ? "The end must be on or after the start."
      : undefined;
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast-periods"),
    queryFn: listForecastPeriods,
    enabled: isOpen,
  });
  const periods = query.data?.rows ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createForecastPeriod({ name, periodType, periodStart, periodEnd }),
    onSuccess: () => {
      setError(null);
      setName("");
      setPeriodStart("");
      setPeriodEnd("");
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "crm", "forecast-periods"),
      });
    },
    onError: (err: unknown) =>
      setError(
        err instanceof CrmForecastApiError
          ? err.message
          : "The forecast period could not be created.",
      ),
  });

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Forecast periods"
    >
      <div className="flex flex-col gap-4">
        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
        {query.isLoading && (
          <LoadingState
            label="Loading periods"
            rows={2}
            onRetry={() => query.refetch()}
          />
        )}
        {query.isError && (
          <ErrorState
            title="Could not load periods"
            action={{ label: "Try again", onPress: () => void query.refetch() }}
          />
        )}
        {query.isSuccess && periods.length === 0 && (
          <p className="text-sm text-text-secondary">
            No forecast periods yet. Add one below so your team can submit what
            they expect to close.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {periods.map((period) => (
            <li
              key={period.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm"
            >
              <span className="flex flex-col">
                <span className="text-text">{period.name}</span>
                <span className="text-xs text-text-muted">
                  {rangeLabel(period.periodStart, period.periodEnd)}
                </span>
              </span>
              <StatusBadge
                tone={
                  period.status === "open"
                    ? "success"
                    : period.status === "closed"
                      ? "neutral"
                      : "info"
                }
              >
                {statusLabel(period.status)}
              </StatusBadge>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 border-t border-border-strong pt-3">
          <TextField
            label="Period name"
            placeholder="For example, Q3 2026"
            value={name}
            onChange={setName}
          />
          <Select
            label="Length of period"
            options={[
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
              { value: "year", label: "Year" },
            ]}
            selectedKey={periodType}
            onSelectionChange={(key) => setPeriodType(String(key ?? "quarter"))}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateInput
              label="Starts on"
              value={periodStart}
              onChange={setPeriodStart}
            />
            <DateInput
              label="Ends on"
              value={periodEnd}
              onChange={setPeriodEnd}
              errorMessage={dateOrderError}
            />
          </div>
          <Button
            variant="secondary"
            size="compact"
            className="self-start"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={
              !name.trim() ||
              !periodStart ||
              !periodEnd ||
              Boolean(dateOrderError)
            }
          >
            Add period
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
