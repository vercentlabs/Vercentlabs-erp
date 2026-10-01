"use client";

import { CheckCircle2 } from "lucide-react";
import {
  Button,
  Checkbox,
  Select,
  StatusBadge,
  TextArea,
  Timeline,
  type SelectOption,
} from "@vercentlabs/design-system";
import type { Dispatch, SetStateAction } from "react";
import { dateTimeFormatter } from "./lead-detail-shared";
import type { LeadDetailData } from "./useLeadDetailData";

// Pipeline tab: dwell in the current stage, the stage move form (including
// the governed override) and stage history.
export function LeadPipelineTab({
  stageDetailQuery,
  reasonsQuery,
  isClosed,
  canManageLeads,
  destinationStageOptions,
  reasonRequired,
  pendingStageId,
  setPendingStageId,
  pendingReasonCode,
  setPendingReasonCode,
  pendingNote,
  setPendingNote,
  stageOverrideMode,
  setStageOverrideMode,
  stageOverrideReason,
  setStageOverrideReason,
  stageMutation,
}: {
  stageDetailQuery: LeadDetailData["stageDetailQuery"];
  reasonsQuery: LeadDetailData["reasonsQuery"];
  isClosed: boolean;
  canManageLeads: boolean;
  destinationStageOptions: SelectOption[];
  reasonRequired: boolean;
  pendingStageId: string;
  setPendingStageId: Dispatch<SetStateAction<string>>;
  pendingReasonCode: string;
  setPendingReasonCode: Dispatch<SetStateAction<string>>;
  pendingNote: string;
  setPendingNote: Dispatch<SetStateAction<string>>;
  stageOverrideMode: boolean;
  setStageOverrideMode: Dispatch<SetStateAction<boolean>>;
  stageOverrideReason: string;
  setStageOverrideReason: Dispatch<SetStateAction<string>>;
  stageMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
    <div className="flex flex-col gap-6 py-4">
      {stageDetailQuery.data && (
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge
            tone={
              stageDetailQuery.data.dwell.status === "breached"
                ? "danger"
                : stageDetailQuery.data.dwell.status === "warning"
                  ? "warning"
                  : "neutral"
            }
          >
            {`Dwell: ${Math.round(stageDetailQuery.data.dwell.elapsedHours)}h in stage`}
          </StatusBadge>
          <span className="text-xs text-text-muted">
            Entered{" "}
            {dateTimeFormatter.format(
              new Date(stageDetailQuery.data.dwell.enteredAt),
            )}
          </span>
        </div>
      )}

      {!isClosed && canManageLeads && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Move to stage…</p>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Destination stage"
              size="compact"
              options={destinationStageOptions}
              selectedKey={pendingStageId}
              onSelectionChange={(key) => setPendingStageId(String(key ?? ""))}
              className="min-w-[220px]"
              placeholder={
                destinationStageOptions.length
                  ? "Choose a stage"
                  : "No legal transitions configured"
              }
            />
            <Button
              variant="secondary"
              size="compact"
              onPress={() => stageMutation.mutate()}
              isLoading={stageMutation.isPending}
              isDisabled={
                !pendingStageId ||
                (reasonRequired && !pendingReasonCode && !stageOverrideMode) ||
                (stageOverrideMode && stageOverrideReason.trim().length < 3)
              }
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Move
            </Button>
          </div>
          {pendingStageId && reasonRequired && !stageOverrideMode && (
            <Select
              label="Reason (required for this transition)"
              size="compact"
              options={(reasonsQuery.data?.reasons ?? []).map((reason) => ({
                value: reason.code,
                label: reason.label,
              }))}
              selectedKey={pendingReasonCode}
              onSelectionChange={(key) =>
                setPendingReasonCode(String(key ?? ""))
              }
              className="max-w-[280px]"
              placeholder="Choose a reason…"
            />
          )}
          {pendingStageId && (
            <TextArea
              label="Note (optional)"
              value={pendingNote}
              onChange={setPendingNote}
            />
          )}
          {stageDetailQuery.data?.canOverride && (
            <Checkbox
              isSelected={stageOverrideMode}
              onChange={(checked) => {
                setStageOverrideMode(checked);
                setPendingStageId("");
                setPendingReasonCode("");
                setStageOverrideReason("");
              }}
            >
              Move to a different stage (advanced) — outside the normal
              lifecycle path
            </Checkbox>
          )}
          {stageOverrideMode && (
            <TextArea
              label="Override reason"
              description="Explain why this Lead is moving outside its normal lifecycle path. Recorded permanently on the stage history."
              value={stageOverrideReason}
              onChange={setStageOverrideReason}
            />
          )}
        </div>
      )}

      {stageDetailQuery.data && stageDetailQuery.data.history.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Stage history</p>
          <Timeline
            entries={stageDetailQuery.data.history.map((event) => ({
              id: event.id,
              title: `${event.actorName || "Someone"} moved ${event.fromStageName} → ${event.toStageName}${event.overrideUsed ? " (override)" : ""}`,
              description:
                event.overrideReason ||
                event.reasonLabel ||
                event.note ||
                undefined,
              timestamp: dateTimeFormatter.format(new Date(event.createdAt)),
            }))}
          />
        </div>
      )}
    </div>
  );
}
