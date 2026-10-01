"use client";

import { useQuery } from "@tanstack/react-query";
import { Dialog } from "@vercentlabs/design-system";
import { LoadingState } from "@/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDateTime, formatMoney, humanize } from "@/shared/format/human";
import {
  listGovernedSubmissionEvents,
  type ForecastOwnerRow,
} from "../api/forecast-api";
import { num } from "./forecast-format";

export function HistoryDialog({
  owner,
  currency,
  onClose,
}: {
  owner: ForecastOwnerRow | null;
  currency: string | null;
  onClose: () => void;
}) {
  const workspace = useWorkspaceContext();
  const submissionId = owner?.submission?.id ?? "";
  const query = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "forecast-history",
      submissionId,
    ),
    queryFn: () => listGovernedSubmissionEvents(submissionId),
    enabled: Boolean(submissionId),
  });
  return (
    <Dialog
      isOpen={owner !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        owner ? `${owner.ownerName}: forecast history` : "Forecast history"
      }
    >
      {query.isLoading ? (
        <LoadingState label="Loading history" rows={3} />
      ) : (
        <ol className="flex flex-col gap-2 text-sm">
          {(query.data?.events ?? []).map((event) => (
            <li key={event.id} className="flex flex-col">
              <span className="font-medium text-text">{`${humanize(event.eventType)} by ${event.actorName ?? "someone"} · ${formatDateTime(event.createdAt)}`}</span>
              <span className="text-text-secondary">
                {`Commit ${formatMoney(currency, event.commitAmount)}`}
                {num(event.managerAdjustment) !== 0
                  ? `, adjustment ${formatMoney(currency, event.managerAdjustment)}`
                  : ""}
                {event.reason ? ` — ${event.reason}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
