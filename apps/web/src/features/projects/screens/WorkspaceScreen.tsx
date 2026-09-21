"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { act, ProjectsApiError, readView, useProjectsOptions } from "@/features/projects/shared/client";
import { ProjectsAlert, ProjectsPanel, useCan } from "@/features/projects/shared/ProjectsUi";
import { calendarDate, label, money } from "@/features/projects/shared/format";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

type Rec = Record<string, unknown>;
type WbsNode = Rec & { id: string; children: WbsNode[]; depth: number };
type GanttTask = { id: string; wbs: string | null; number: string; name: string; start: string | null; end: string | null; progress: number; status: string; assignee: string | null; critical: boolean; baselineEnd: string | null };

const VIEWS: Array<[string, string, string]> = [
  ["overview", "Overview", "The project, its team and what still blocks it from being completed."],
  ["wbs", "Work breakdown", "Tasks and sub-tasks with rolled-up hours."],
  ["gantt", "Gantt and critical path", "Bars from the task dates; critical tasks are the ones that set the finish date."],
  ["kanban", "Board", "Leaf tasks by status."],
  ["calendar", "Calendar", "Tasks, milestones and approved leave in a window."],
  ["progress", "Progress", "Weighted roll-up of task progress and the status reports."],
  ["schedule", "Schedule", "Dates worked out from dependencies, durations and working days."],
  ["baselines", "Baselines", "Approved reference plans and the variance against them."],
  ["cost", "Cost", "Approved budget against actual cost and its breakdown."],
  ["profitability", "Profitability", "Revenue recognised, margin, earned-value indices and forecast."],
  ["capacity", "Capacity", "Each person's capacity less allocation and approved leave."],
];

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const AMOUNTY = /(amount|cost|budget|revenue|margin|variance|actual|committed|value|price|rate|eac|vac)/i;
const cell = (key: string, value: unknown) => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || (typeof value === "string" && AMOUNTY.test(key) && !Number.isNaN(Number(value)))) return AMOUNTY.test(key) ? money(value) : String(Math.round(Number(value) * 100) / 100);
  if (typeof value === "object") return JSON.stringify(value);
  return /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? calendarDate(value) : String(value).slice(0, 200);
};

function Table({ rows }: { rows: Rec[] }) {
  if (rows.length === 0) return <p className="text-sm text-text-muted">Nothing to show.</p>;
  const columns = Object.keys(rows[0]).filter((k) => !/(^id$|_id$|Id$)/.test(k) && typeof rows[0][k] !== "object");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-left text-text-muted">{columns.map((c) => <th key={c} className="px-2 py-1 font-medium">{label(c)}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i} className="border-b border-border/50">{columns.map((c) => <td key={c} className="px-2 py-1">{cell(c, row[c])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// Renders any analysis result: scalars become headline numbers, arrays become tables, nested objects recurse.
function Generic({ data, title }: { data: unknown; title?: string }) {
  if (Array.isArray(data)) return <ProjectsPanel title={title}><Table rows={data.filter(isRec)} /></ProjectsPanel>;
  if (!isRec(data)) return null;
  const scalars = Object.entries(data).filter(([, v]) => v === null || typeof v !== "object");
  const nested = Object.entries(data).filter(([, v]) => v !== null && typeof v === "object");
  return (
    <>
      {scalars.length > 0 && (
        <ProjectsPanel title={title}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {scalars.map(([k, v]) => <div key={k}><dt className="text-xs text-text-muted">{label(k)}</dt><dd className="text-lg font-semibold tabular-nums">{cell(k, v) || "—"}</dd></div>)}
          </dl>
        </ProjectsPanel>
      )}
      {nested.map(([k, v]) => <Generic key={k} data={v} title={label(k)} />)}
    </>
  );
}

function WbsRows({ nodes }: { nodes: WbsNode[] }) {
  return (
    <>
      {nodes.map((n) => (
        <div key={n.id}>
          <div className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1 text-sm" style={{ paddingLeft: n.depth * 20 }}>
            <span><span className="text-text-muted">{String(n.wbs_code ?? "")}</span> <span className="font-medium">{String(n.name)}</span> <span className="text-text-muted">({label(n.status)})</span></span>
            <span className="tabular-nums text-text-muted">{String(n.percent_complete)}% · {String(n.rollup_hours ?? n.estimated_hours)}h est · {String(n.rollup_actual ?? n.actual_hours)}h actual</span>
          </div>
          <WbsRows nodes={n.children} />
        </div>
      ))}
    </>
  );
}

function Gantt({ data }: { data: { project: { start: string | null; end: string | null }; today: string; tasks: GanttTask[] } }) {
  const dated = data.tasks.filter((t) => t.start && t.end);
  if (dated.length === 0) return <p className="text-sm text-text-muted">No task has dates yet. Add dates or durations, then apply the schedule.</p>;
  const day = (s: string) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`).getTime() / 86400000;
  const min = Math.min(...dated.map((t) => day(t.start as string)));
  const max = Math.max(...dated.map((t) => day(t.end as string)));
  const span = Math.max(1, max - min + 1);
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="gantt">
      {dated.map((t) => {
        const left = ((day(t.start as string) - min) / span) * 100;
        const width = Math.max(1.5, ((day(t.end as string) - day(t.start as string) + 1) / span) * 100);
        return (
          <div key={t.id} className="grid grid-cols-[minmax(160px,260px)_1fr] items-center gap-2">
            <span className="truncate">{t.wbs} {t.name}{t.critical ? " (critical)" : ""}</span>
            <div className="relative h-5 rounded bg-surface-hover">
              <div className={`absolute top-0 h-5 rounded ${t.critical ? "bg-danger" : "bg-brand"}`} style={{ left: `${left}%`, width: `${width}%`, opacity: 0.85 }} title={`${calendarDate(t.start)} to ${calendarDate(t.end)} · ${t.progress}%`}>
                <div className="h-5 rounded bg-black/25" style={{ width: `${Math.min(100, t.progress)}%` }} />
              </div>
            </div>
          </div>
        );
      })}
      <p className="pt-2 text-xs text-text-muted">{calendarDate(new Date(min * 86400000).toISOString())} to {calendarDate(new Date(max * 86400000).toISOString())}. The darker part of a bar is the progress.</p>
    </div>
  );
}

export function WorkspaceScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const options = useProjectsOptions();
  const [projectId, setProjectId] = useState("");
  const [view, setView] = useState("overview");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState({ health: "on_track", summary: "", accomplishments: "", nextSteps: "", blockers: "" });
  const projects = options.data?.projects ?? [];
  const current = VIEWS.find((v) => v[0] === view) ?? VIEWS[0];
  const needsProject = view !== "capacity";

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "projects", "workspace", view, projectId),
    enabled: !needsProject || Boolean(projectId),
    queryFn: async () => {
      const p = { projectId, id: projectId };
      switch (view) {
        case "overview": {
          const [project, blockers] = await Promise.all([readView<{ project: Rec }>("project", p), readView<{ blockers: unknown }>("close-blockers", p)]);
          return { project: project.project, blockers: blockers.blockers } as unknown;
        }
        case "wbs": return (await readView<{ wbs: unknown }>("wbs", p)).wbs;
        case "gantt": return (await readView<{ gantt: unknown }>("gantt", p)).gantt;
        case "kanban": return (await readView<{ board: unknown }>("kanban", p)).board;
        case "calendar": return (await readView<{ calendar: unknown }>("calendar", p)).calendar;
        case "progress": return (await readView<{ progress: unknown }>("progress", p)).progress;
        case "schedule": {
          const [schedule, conflicts] = await Promise.all([readView<{ schedule: unknown }>("schedule", p), readView<{ conflicts: unknown }>("conflicts", p)]);
          return { schedule: schedule.schedule, conflicts: conflicts.conflicts } as unknown;
        }
        case "baselines": {
          const [rows, variance] = await Promise.all([readView<{ rows: unknown }>("baselines", p), readView<{ variance: unknown }>("schedule-variance", p)]);
          return { baselines: rows.rows, variance: variance.variance } as unknown;
        }
        case "cost": {
          const [variance, breakdown] = await Promise.all([readView<{ variance: unknown }>("cost-variance", p), readView<{ breakdown: unknown }>("cost-breakdown", p)]);
          return { variance: variance.variance, breakdown: breakdown.breakdown } as unknown;
        }
        case "profitability": return (await readView<{ profitability: unknown }>("profitability", p)).profitability;
        default: return (await readView<{ availability: unknown }>("availability")).availability;
      }
    },
  });

  const run = useMutation({
    mutationFn: ({ action, input, success }: { action: string; input: Rec; success: string }) => act(action, input).then(() => success),
    onSuccess: (success) => { setMessage(success); setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); },
    onError: (e) => { setError(e instanceof ProjectsApiError ? e.message : "This could not be completed."); setMessage(null); },
  });

  const data = query.data as unknown;
  const loadError = query.error instanceof ProjectsApiError ? query.error.message : query.isError ? "This view could not be loaded." : null;
  const board = view === "kanban" && isRec(data) ? (data.columns as Array<{ status: string; tasks: Rec[] }>) : null;
  const blockers = view === "overview" && isRec(data) ? data.blockers : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Project workspace" description={current[2]} />
      <ProjectsPanel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Project" options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} selectedKey={projectId || null} onSelectionChange={(k) => setProjectId(String(k))} />
          <Select label="View" options={VIEWS.map(([value, text]) => ({ value, label: text }))} selectedKey={view} onSelectionChange={(k) => setView(String(k))} />
        </div>
      </ProjectsPanel>
      {error && <ProjectsAlert>{error}</ProjectsAlert>}
      {message && <ProjectsAlert tone="success">{message}</ProjectsAlert>}
      {loadError && <ProjectsAlert>{loadError}</ProjectsAlert>}
      {needsProject && !projectId && <p className="text-sm text-text-muted">Choose a project.</p>}
      {query.isLoading && <p className="text-sm text-text-muted">Loading…</p>}

      {view === "wbs" && isRec(data) && <ProjectsPanel title="Work breakdown structure"><WbsRows nodes={(data.tree ?? []) as WbsNode[]} /></ProjectsPanel>}
      {view === "gantt" && isRec(data) && <ProjectsPanel title="Gantt"><Gantt data={data as unknown as Parameters<typeof Gantt>[0]["data"]} /></ProjectsPanel>}
      {board && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5" data-testid="kanban">
          {board.map((column) => (
            <ProjectsPanel key={column.status} title={`${label(column.status)} (${column.tasks.length})`}>
              <ul className="flex flex-col gap-2">
                {column.tasks.map((t) => <li key={String(t.id)} className="rounded border border-border px-2 py-1 text-sm"><div className="font-medium">{String(t.task_number)} {String(t.name)}</div><div className="text-xs text-text-muted">{String(t.assignee_name ?? "Unassigned")} · {label(t.priority)}</div></li>)}
              </ul>
            </ProjectsPanel>
          ))}
        </div>
      )}
      {view === "overview" && isRec(data) && isRec(data.project) && (
        <>
          <Generic title="Project" data={Object.fromEntries(Object.entries(data.project.project as Rec).filter(([, v]) => v === null || typeof v !== "object"))} />
          <Generic title="Team" data={data.project.members} />
          <Generic title="Before it can be completed" data={blockers} />
        </>
      )}
      {!["wbs", "gantt", "kanban", "overview"].includes(view) && data !== undefined && !query.isLoading && <Generic data={data} />}

      {projectId && view === "schedule" && can("projects.manage") && (
        <ProjectsPanel title="Apply">
          <p className="text-sm text-text-muted">Writes the calculated dates to the tasks that are not yet started.</p>
          <div className="flex justify-end"><Button variant="primary" isLoading={run.isPending} onPress={() => run.mutate({ action: "schedule-apply", input: { projectId }, success: "Schedule applied." })}>Apply schedule</Button></div>
        </ProjectsPanel>
      )}
      {projectId && view === "baselines" && can("projects.manage") && (
        <ProjectsPanel title="Baseline">
          <div className="flex justify-end"><Button variant="primary" isLoading={run.isPending} onPress={() => run.mutate({ action: "baseline-create", input: { projectId }, success: "Baseline submitted." })}>Capture current plan as a baseline</Button></div>
        </ProjectsPanel>
      )}
      {projectId && view === "profitability" && can("projects.profitability.view") && (
        <ProjectsPanel title="Snapshot">
          <div className="flex justify-end"><Button onPress={() => run.mutate({ action: "profitability-snapshot", input: { projectId }, success: "Snapshot captured." })}>Capture a profitability snapshot</Button></div>
        </ProjectsPanel>
      )}
      {projectId && view === "progress" && can("projects.manage") && (
        <ProjectsPanel title="Status report">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Health" options={["on_track", "at_risk", "off_track"].map((v) => ({ value: v, label: label(v) }))} selectedKey={report.health} onSelectionChange={(k) => setReport((r) => ({ ...r, health: String(k) }))} />
            <TextField label="Summary" value={report.summary} onChange={(v) => setReport((r) => ({ ...r, summary: v }))} />
            <TextField label="Accomplishments" value={report.accomplishments} onChange={(v) => setReport((r) => ({ ...r, accomplishments: v }))} />
            <TextField label="Next steps" value={report.nextSteps} onChange={(v) => setReport((r) => ({ ...r, nextSteps: v }))} />
            <TextField label="Blockers" value={report.blockers} onChange={(v) => setReport((r) => ({ ...r, blockers: v }))} />
          </div>
          <div className="flex justify-end"><Button variant="primary" isLoading={run.isPending} onPress={() => run.mutate({ action: "status-report", input: { projectId, ...report }, success: "Status report saved." })}>Save status report</Button></div>
        </ProjectsPanel>
      )}
    </div>
  );
}
