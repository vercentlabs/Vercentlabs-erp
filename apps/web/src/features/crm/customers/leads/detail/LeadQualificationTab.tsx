"use client";

import { ShieldAlert } from "lucide-react";
import {
  Button,
  Checkbox,
  Select,
  StatusBadge,
  TextArea,
  Timeline,
} from "@vercentlabs/design-system";
import type { Dispatch, SetStateAction } from "react";
import { humanize } from "@/shared/format/human";
import { Field, dateTimeFormatter } from "./lead-detail-shared";
import type { LeadDetailData } from "./useLeadDetailData";

// Qualification tab: current decision, readiness criteria, the decision
// form and decision history.
export function LeadQualificationTab({
  qualificationQuery,
  qualification,
  isClosed,
  canManageLeads,
  qualDecision,
  setQualDecision,
  qualReasonCode,
  setQualReasonCode,
  qualReasonText,
  setQualReasonText,
  qualNote,
  setQualNote,
  qualOverride,
  setQualOverride,
  qualOverrideReason,
  setQualOverrideReason,
  qualifyMutation,
}: {
  qualificationQuery: LeadDetailData["qualificationQuery"];
  qualification:
    | NonNullable<LeadDetailData["qualificationQuery"]["data"]>["qualification"]
    | undefined;
  isClosed: boolean;
  canManageLeads: boolean;
  qualDecision: "qualified" | "unqualified" | "";
  setQualDecision: Dispatch<SetStateAction<"qualified" | "unqualified" | "">>;
  qualReasonCode: string;
  setQualReasonCode: Dispatch<SetStateAction<string>>;
  qualReasonText: string;
  setQualReasonText: Dispatch<SetStateAction<string>>;
  qualNote: string;
  setQualNote: Dispatch<SetStateAction<string>>;
  qualOverride: boolean;
  setQualOverride: Dispatch<SetStateAction<boolean>>;
  qualOverrideReason: string;
  setQualOverrideReason: Dispatch<SetStateAction<string>>;
  qualifyMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
    <div className="flex flex-col gap-6 py-4">
      {qualificationQuery.isLoading ? (
        <p className="text-sm text-text-secondary">Loading qualification…</p>
      ) : qualification ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              tone={
                qualification.state === "qualified"
                  ? "success"
                  : qualification.state === "unqualified"
                    ? "danger"
                    : "neutral"
              }
            >
              {humanize(qualification.state)}
            </StatusBadge>
            {qualification.history[0]?.overrideUsed &&
              qualification.decidedAt && (
                <StatusBadge tone="warning">
                  Decided with an override
                </StatusBadge>
              )}
            {qualification.decidedAt && (
              <span className="text-xs text-text-muted">
                Decided by {qualification.decidedByName || "—"} on{" "}
                {dateTimeFormatter.format(new Date(qualification.decidedAt))}
              </span>
            )}
          </div>
          {qualification.reasonCode && (
            <Field
              label="Reason"
              value={`${humanize(qualification.reasonCode)}${qualification.reasonText ? `: ${qualification.reasonText}` : ""}`}
            />
          )}
          {qualification.note && (
            <Field label="Note" value={qualification.note} />
          )}

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-text">
              Readiness criteria
            </p>
            <p className="text-xs text-text-muted">
              Evaluated live from current Lead data as of{" "}
              {dateTimeFormatter.format(new Date(qualification.evaluatedAt))}.
            </p>
            <ul className="flex flex-col gap-1">
              {qualification.readiness.required.map((criterion) => (
                <li
                  key={criterion.key}
                  className={`text-sm ${criterion.met ? "text-success" : "text-danger"}`}
                >
                  {criterion.met ? "✓" : "✗"} {criterion.label}{" "}
                  <span className="text-text-muted">(required)</span>
                </li>
              ))}
              {qualification.readiness.recommended.map((criterion) => (
                <li
                  key={criterion.key}
                  className={`text-sm ${criterion.met ? "text-success" : "text-text-muted"}`}
                >
                  {criterion.met ? "✓" : "○"} {criterion.label}{" "}
                  <span className="text-text-muted">(recommended)</span>
                </li>
              ))}
            </ul>
            {!qualification.readiness.ready && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <ShieldAlert className="size-3.5" aria-hidden="true" />
                Required evidence is missing — qualifying now requires an
                authorized override with a reason.
              </p>
            )}
          </div>

          {!isClosed && canManageLeads && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-sm font-semibold text-text">Decide</p>
              <Select
                label="Decision"
                size="compact"
                options={[
                  { value: "qualified", label: "Qualified" },
                  { value: "unqualified", label: "Unqualified" },
                ]}
                selectedKey={qualDecision}
                onSelectionChange={(key) =>
                  setQualDecision(String(key) as "qualified" | "unqualified")
                }
                className="max-w-[220px]"
                placeholder="Choose…"
              />
              {qualDecision === "unqualified" && (
                <>
                  <Select
                    label="Reason"
                    size="compact"
                    options={qualification.reasons.map((reason) => ({
                      value: reason.code,
                      label: reason.label,
                    }))}
                    selectedKey={qualReasonCode}
                    onSelectionChange={(key) =>
                      setQualReasonCode(String(key ?? ""))
                    }
                    className="max-w-[280px]"
                    placeholder="Choose a reason…"
                  />
                  {qualReasonCode === "other" && (
                    <TextArea
                      label="Explain"
                      value={qualReasonText}
                      onChange={setQualReasonText}
                    />
                  )}
                </>
              )}
              <TextArea
                label="Note (optional)"
                value={qualNote}
                onChange={setQualNote}
              />
              {qualDecision === "qualified" &&
                !qualification.readiness.ready &&
                qualification.canOverride && (
                  <div className="flex flex-col gap-2">
                    <Checkbox
                      isSelected={qualOverride}
                      onChange={setQualOverride}
                    >
                      Override — qualify despite missing required evidence
                    </Checkbox>
                    {qualOverride && (
                      <TextArea
                        label="Override reason"
                        value={qualOverrideReason}
                        onChange={setQualOverrideReason}
                      />
                    )}
                  </div>
                )}
              <Button
                variant="primary"
                size="compact"
                className="w-fit"
                onPress={() => qualifyMutation.mutate()}
                isLoading={qualifyMutation.isPending}
                isDisabled={
                  !qualDecision ||
                  (qualDecision === "unqualified" && !qualReasonCode)
                }
              >
                Save decision
              </Button>
            </div>
          )}

          {qualification.history.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-sm font-semibold text-text">History</p>
              <Timeline
                entries={qualification.history.map((event) => ({
                  id: event.id,
                  tone:
                    event.newState === "qualified"
                      ? "success"
                      : event.newState === "unqualified"
                        ? "danger"
                        : "neutral",
                  title: `${event.decidedByName || "Someone"} set qualification to ${humanize(event.newState).toLowerCase()}${event.overrideUsed ? " (override)" : ""}`,
                  description:
                    event.reasonText ||
                    event.reasonCode ||
                    event.note ||
                    undefined,
                  timestamp: dateTimeFormatter.format(
                    new Date(event.createdAt),
                  ),
                }))}
              />
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-text-secondary">
          Qualification data is unavailable.
        </p>
      )}
    </div>
  );
}
