"use client";

// Projects — Project Status reports, as a set of Project Reports: projects by status, the active, planned, held, completed and cancelled
// projects, every status change with its reason, hold durations, completions that waived work or left something outstanding, and reopenings.
import Link from "next/link";

import { formatDateTime } from "@/shared/format/human";
import { Cell, LinesTable } from "@/shared/ui/record";

import { PROJECTS_BASE, dateLabel } from "../api/projects-api";

export const STATUS_REPORT_TABS = [{ id: "st-by-status", label: "Projects by status" }, { id: "st-active", label: "Active" }, { id: "st-planned", label: "Planned" },
  { id: "st-on-hold", label: "On hold" }, { id: "st-completed", label: "Completed" }, { id: "st-cancelled", label: "Cancelled" }, { id: "st-status-changes", label: "Status changes" },
  { id: "st-hold-duration", label: "Hold duration" }, { id: "st-completion-exceptions", label: "Completion exceptions" }, { id: "st-reopened", label: "Reopened" }];

type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const projectLink = (row: Row) => <Link className="text-brand underline" href={`${PROJECTS_BASE}/${s(row.projectId ?? row.id)}`}>{s(row.name) || "Untitled draft"} <span className="text-text-muted">{s(row.code)}</span></Link>;

export function StatusReport({ kind, rows }: { kind: string; rows: Row[] }) {
  switch (kind) {
    case "st-by-status": return (
      <LinesTable columns={["Status", { label: "Projects", numeric: true }, { label: "Of them archived", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.status)}><Cell>{s(row.label)}</Cell><Cell numeric>{s(row.total)}</Cell><Cell numeric>{s(row.archived)}</Cell></tr>)}
      </LinesTable>
    );
    case "st-active": case "st-planned": case "st-completed": case "st-cancelled": case "st-reopened": return (
      <LinesTable columns={["Project", "Manager", "Target", kind === "st-cancelled" ? "Why cancelled" : kind === "st-reopened" ? "Reopened" : kind === "st-completed" ? "Completed" : "Started"]}>
        {rows.map((row) => (
          <tr key={s(row.id)}><Cell>{projectLink(row)}</Cell><Cell>{s(row.manager) || "—"}</Cell><Cell>{dateLabel(s(row.targetEndDate) || null)}</Cell>
            <Cell>{kind === "st-cancelled" ? s(row.cancelReason) : kind === "st-reopened" ? `${s(row.reopenCount)} time(s), last ${row.lastReopenedAt ? formatDateTime(s(row.lastReopenedAt)) : "—"}`
              : kind === "st-completed" ? dateLabel(s(row.completedAt) || null) : dateLabel(s(row.actualStartDate) || null)}</Cell></tr>
        ))}
      </LinesTable>
    );
    case "st-on-hold": case "st-hold-duration": return (
      <LinesTable columns={["Project", "Held since", ...(kind === "st-hold-duration" ? ["Ended"] : []), { label: "Days", numeric: true }, { label: "Open reasons", numeric: true }, kind === "st-on-hold" ? "Still holding it" : "Reasons"]}>
        {rows.map((row, index) => (
          <tr key={index}><Cell>{projectLink(row)}</Cell><Cell>{formatDateTime(s(row.startedAt))}</Cell>{kind === "st-hold-duration" && <Cell>{row.endedAt ? formatDateTime(s(row.endedAt)) : "Still on hold"}</Cell>}
            <Cell numeric>{s(row.days)}</Cell><Cell numeric>{s(row.openReasons)}</Cell><Cell>{kind === "st-on-hold" ? s(row.openText) || "—" : s(row.summary)}</Cell></tr>
        ))}
      </LinesTable>
    );
    case "st-status-changes": return (
      <LinesTable columns={["When", "Project", "From", "To", "Why", "Who"]}>
        {rows.map((row, index) => (
          <tr key={index}><Cell>{formatDateTime(s(row.at))}</Cell><Cell>{projectLink(row)}</Cell><Cell>{s(row.fromLabel) || "Created"}</Cell><Cell>{s(row.toLabel)}</Cell>
            <Cell>{s(row.reason) || "—"}</Cell><Cell>{s(row.actor)}</Cell></tr>
        ))}
      </LinesTable>
    );
    case "st-completion-exceptions": return (
      <LinesTable columns={["Project", "Completed", "Signed off by", "Waived", "Outstanding at completion"]}>
        {rows.map((row, index) => (
          <tr key={index}><Cell>{projectLink(row)}</Cell><Cell>{dateLabel(s(row.completionDate) || null)}</Cell><Cell>{s(row.signedOffBy) || "—"}</Cell>
            <Cell>{((row.waivers as Array<{ code: string; reason: string }>) ?? []).map((waiver) => `${waiver.code}: ${waiver.reason}`).join("; ") || "—"}</Cell>
            <Cell>{((row.outstanding as Array<{ label: string }>) ?? []).map((item) => item.label).join(", ") || "—"}</Cell></tr>
        ))}
      </LinesTable>
    );
    default: return null;
  }
}
