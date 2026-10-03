"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  MetricStrip,
  NumberField,
  PageHeader,
  PermissionState,
  StatusBadge,
  TextArea,
  TextField,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  act,
  HrApiError,
  readView,
  type Row,
} from "@/features/hr/shared/client";
import { calendarDate, label, tone } from "@/features/hr/shared/format";
import { HrAlert, HrPanel, useCan } from "@/features/hr/shared/HrUi";

type Dashboard = {
  headcount: number;
  status: Record<string, number>;
  overdueTasks: number;
  byDepartment: Array<{ name: string; n: number }>;
  byEmploymentType: Array<{ employment_type: string; n: number }>;
};

const LINKS: Array<[string, string, string]> = [
  ["Employees", "/hr/employees", "The workforce and each person's record"],
  ["Organization", "/hr/organization", "Reporting lines and departments"],
  ["Onboarding", "/hr/onboarding", "Joining checklists"],
  ["Attendance", "/hr/attendance", "Who is in, and their hours"],
  ["Leave requests", "/hr/leave-requests", "Requests and approvals"],
  ["Payroll", "/hr/payroll", "Periods, runs and payslips"],
  ["My profile", "/hr/me", "Your own details"],
];

export function HrHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "hr", "dashboard"),
    queryFn: () =>
      readView<{ dashboard: Dashboard }>("dashboard").then((r) => r.dashboard),
  });
  const d = query.data;
  if (
    query.isError &&
    query.error instanceof HrApiError &&
    query.error.status === 403
  )
    return (
      <PermissionState
        title="You don't have access to HR & Payroll"
        description="Ask an administrator to grant hr_payroll.view. You can still open My profile."
      />
    );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="HR & Payroll"
        description="The workforce today, and what needs attention."
      />
      <MetricStrip
        metrics={[
          { label: "Headcount", value: d ? String(d.headcount) : "…" },
          {
            label: "Not yet joined",
            value: d ? String(d.status.draft ?? 0) : "…",
          },
          {
            label: "Serving notice",
            value: d ? String(d.status.on_notice ?? 0) : "…",
          },
          { label: "Overdue tasks", value: d ? String(d.overdueTasks) : "…" },
        ]}
      />
      {d && d.byDepartment.length > 0 && (
        <HrPanel title="Headcount by department">
          <ul className="text-sm" aria-label="Headcount by department">
            {d.byDepartment.map((row) => (
              <li key={row.name}>
                {row.name} — {row.n}
              </li>
            ))}
          </ul>
        </HrPanel>
      )}
      <HrPanel title="Go to">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {LINKS.map(([title, href, description]) => (
            <li key={href}>
              <Link
                href={href}
                className="flex flex-col rounded-[var(--radius-control)] border border-border p-3 hover:bg-surface-hover"
              >
                <span className="font-medium text-text">{title}</span>
                <span className="text-xs text-text-muted">{description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </HrPanel>
    </div>
  );
}

// ---------------------------------------------------------------- organization chart (F383/F385)
type Node = {
  id: string;
  employee_number: string;
  manager_employee_id: string | null;
  full_name: string;
  designation_name: string | null;
  department_name: string | null;
  status: string;
};

export function OrgChartScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "hr", "org-chart"),
    queryFn: () => readView<{ rows: Node[] }>("org-chart").then((r) => r.rows),
  });
  if (
    query.isError &&
    query.error instanceof HrApiError &&
    query.error.status === 403
  )
    return (
      <PermissionState
        title="You don't have access to the organization chart"
        description="Ask an administrator to grant hr_payroll.view."
      />
    );
  const rows = query.data ?? [];
  const known = new Set(rows.map((r) => r.id));
  const children = new Map<string | null, Node[]>();
  for (const r of rows) {
    const parent =
      r.manager_employee_id && known.has(r.manager_employee_id)
        ? r.manager_employee_id
        : null;
    children.set(parent, [...(children.get(parent) ?? []), r]);
  }
  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((n) => (
      <li key={n.id} style={{ paddingLeft: depth ? 20 : 0 }}>
        <Link
          className="font-medium text-brand hover:underline"
          href={`/hr/employee/${n.id}`}
        >
          {n.full_name}
        </Link>
        <span className="text-text-muted">
          {" "}
          · {n.employee_number} · {n.designation_name ?? "—"} ·{" "}
          {n.department_name ?? "—"}
        </span>
        {n.status === "on_notice" && (
          <>
            {" "}
            <StatusBadge tone="warning">On notice</StatusBadge>
          </>
        )}
        {(children.get(n.id) ?? []).length > 0 && (
          <ul className="mt-1 border-l border-border">
            {render(n.id, depth + 1)}
          </ul>
        )}
      </li>
    ));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Organization"
        description="Who reports to whom. A reporting line can never loop back on itself."
      />
      <HrPanel>
        {query.isLoading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-muted">No current employees yet.</p>
        ) : (
          <ul
            className="flex flex-col gap-2 text-sm"
            aria-label="Organization chart"
          >
            {render(null, 0)}
          </ul>
        )}
      </HrPanel>
    </div>
  );
}

// ---------------------------------------------------------------- employee 360 (F381)
function Field({ name, value }: { name: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-text-muted">{name}</dt>
      <dd className="text-sm text-text">
        {value === null || value === undefined || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

export function EmployeeDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "hr", "employee", id),
    queryFn: () =>
      readView<{ employee: Row }>("employee", { id }).then((r) => r.employee),
  });
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "hr"),
      });
    },
    onError: (e) =>
      setError(
        e instanceof HrApiError ? e.message : "This could not be completed.",
      ),
  });
  if (
    query.isError &&
    query.error instanceof HrApiError &&
    query.error.status === 403
  )
    return (
      <PermissionState
        title="You don't have access to this employee"
        description="Ask an administrator to grant hr_payroll.employee.view."
      />
    );
  const e = query.data;
  if (!e)
    return (
      <p className="text-sm text-text-muted">
        {query.isError ? "This employee could not be found." : "Loading…"}
      </p>
    );
  const manage = can("hr_payroll.employee.manage");
  const bank = e.bank_details as Record<string, string> | undefined;
  const address = e.address as Record<string, string> | undefined;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={String(e.full_name)}
        description={`${e.employee_number} · ${label(e.employment_type)}${e.designation_name ? ` · ${e.designation_name}` : ""}`}
        primaryAction={
          manage && e.status === "draft" ? (
            <Button
              variant="primary"
              onPress={() => {
                setNotice(null);
                run.mutate(async () => {
                  await act("employee-join", { id });
                  setNotice(
                    "Joined. The onboarding checklist has been raised.",
                  );
                });
              }}
            >
              Complete joining
            </Button>
          ) : undefined
        }
      />
      {notice && <HrAlert tone="success">{notice}</HrAlert>}
      {error && <HrAlert>{error}</HrAlert>}
      <MetricStrip
        metrics={[
          { label: "Status", value: label(e.status) },
          { label: "Probation", value: label(e.probation_status) },
          { label: "Joined", value: calendarDate(e.joining_date) },
          { label: "Reports to", value: String(e.manager_name ?? "—") },
          {
            label: "Direct reports",
            value: String((e.directReports as Row[]).length),
          },
        ]}
      />
      <HrPanel title="Employment">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field name="Department" value={e.department_name} />
          <Field name="Designation" value={e.designation_name} />
          <Field name="Grade" value={e.grade} />
          <Field name="Work location" value={e.work_location} />
          <Field
            name="Probation ends"
            value={calendarDate(e.probation_end_date)}
          />
          <Field
            name="Confirmed on"
            value={calendarDate(e.confirmation_date)}
          />
          <Field name="Notice period" value={`${e.notice_period_days} days`} />
          <Field
            name="Last working day"
            value={
              e.last_working_date ? calendarDate(e.last_working_date) : null
            }
          />
          <Field name="Work email" value={e.work_email} />
        </dl>
        {(e.reportingChain as Row[]).length > 0 && (
          <p className="text-sm text-text-muted" aria-label="Reporting line">
            Reporting line:{" "}
            {(e.reportingChain as Row[]).map((m) => m.name).join(" → ")}
          </p>
        )}
      </HrPanel>
      {e.date_of_birth !== undefined && (
        <HrPanel
          title="Personal and payroll details"
          description="Visible to people with the sensitive-data permission, and to the employee."
        >
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field name="Date of birth" value={calendarDate(e.date_of_birth)} />
            <Field name="Mobile" value={e.personal_phone} />
            <Field name="Personal email" value={e.personal_email} />
            <Field
              name="Address"
              value={
                address
                  ? [address.line1, address.city, address.state]
                      .filter(Boolean)
                      .join(", ")
                  : null
              }
            />
            <Field
              name="PAN"
              value={
                (e.tax_identifiers as Record<string, string> | undefined)?.pan
              }
            />
            <Field
              name="Bank"
              value={
                bank?.account_number
                  ? `${bank.bank_name ?? ""} ••••${bank.account_number.slice(-4)} (${bank.ifsc})`
                  : null
              }
            />
          </dl>
        </HrPanel>
      )}
      <HrPanel title="Checklists">
        {(e.tasks as Row[]).length === 0 ? (
          <p className="text-sm text-text-muted">No onboarding tasks.</p>
        ) : (
          <ul className="text-sm" aria-label="Checklists">
            {(e.tasks as Row[]).map((t) => (
              <li key={String(t.id)} className="flex items-center gap-2">
                <span>
                  {label(t.kind)}: {String(t.title)}
                </span>{" "}
                <StatusBadge tone={tone(t.status)}>
                  {label(t.status)}
                </StatusBadge>
                {manage && t.status === "open" && (
                  <Button
                    variant="ghost"
                    size="compact"
                    onPress={() =>
                      run.mutate(async () => {
                        await act("task-complete", { id: t.id });
                        setNotice("Task completed.");
                      })
                    }
                  >
                    Done
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </HrPanel>
    </div>
  );
}

// ---------------------------------------------------------------- my profile (F396)
export function MyProfileScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "hr", "me"),
    queryFn: () => readView<{ profile: Row }>("me").then((r) => r.profile),
    retry: false,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const done = (message: string) => {
    setError(null);
    setNotice(message);
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(workspace, "hr"),
    });
  };
  const fail = (e: unknown) => {
    setNotice(null);
    setError(e instanceof HrApiError ? e.message : "This could not be saved.");
  };
  const savePhone = useMutation({
    mutationFn: () => act("me-update", { personalPhone: phone ?? "" }),
    onSuccess: () => done("Contact details saved."),
    onError: fail,
  });
  if (query.isError)
    return (
      <HrPanel title="My profile">
        <HrAlert tone="info">
          {query.error instanceof HrApiError
            ? query.error.message
            : "Your profile could not be loaded."}
        </HrAlert>
      </HrPanel>
    );
  const p = query.data;
  if (!p) return <p className="text-sm text-text-muted">Loading…</p>;
  const tasks = (p.tasks as Row[]).filter((t) => t.status === "open");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My profile"
        description={`${p.full_name} · ${p.employee_number}`}
      />
      {notice && <HrAlert tone="success">{notice}</HrAlert>}
      {error && <HrAlert>{error}</HrAlert>}
      <MetricStrip
        metrics={[
          { label: "Status", value: label(p.status) },
          { label: "Department", value: String(p.department_name ?? "—") },
          { label: "Designation", value: String(p.designation_name ?? "—") },
          { label: "Reports to", value: String(p.manager_name ?? "—") },
          { label: "Joined", value: calendarDate(p.joining_date) },
        ]}
      />
      <HrPanel
        title="Contact details"
        description="You can change these yourself."
      >
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="Mobile"
            value={phone ?? String(p.personal_phone ?? "")}
            onChange={setPhone}
          />
          <Button
            variant="primary"
            onPress={() => savePhone.mutate()}
            isLoading={savePhone.isPending}
            isDisabled={phone === null}
          >
            Save contact details
          </Button>
        </div>
      </HrPanel>
      {tasks.length > 0 && (
        <HrPanel title="My checklist">
          <ul className="text-sm" aria-label="My checklist">
            {tasks.map((t) => (
              <li key={String(t.id)}>
                {label(t.kind)}: {String(t.title)}
                {t.due_date ? ` · due ${calendarDate(t.due_date)}` : ""}
              </li>
            ))}
          </ul>
        </HrPanel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings
const toLines = (list: unknown) =>
  ((list as Array<{ title: string; owner?: string }> | undefined) ?? [])
    .map((i) => (i.owner ? `${i.title} | ${i.owner}` : i.title))
    .join("\n");
const fromLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [title, owner] = l.split("|").map((s) => s.trim());
      return { title, owner: owner ?? "" };
    });

export function HrSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "hr", "settings"),
    queryFn: () =>
      readView<{ settings: Row }>("settings").then((r) => r.settings),
  });
  const [draft, setDraft] = useState<Record<string, string | number> | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = query.data;
  const v = (key: string, fallback: string | number) =>
    draft && key in draft ? draft[key] : fallback;
  const set = (key: string, value: string | number) =>
    setDraft({ ...(draft ?? {}), [key]: value });
  const save = useMutation({
    mutationFn: () =>
      act("settings-save", {
        employeeNumberPrefix: v("prefix", s?.employee_number_prefix),
        employeeNumberPadding: Number(v("padding", s?.employee_number_padding)),
        defaultProbationMonths: Number(
          v("probation", s?.default_probation_months),
        ),
        defaultNoticeDays: Number(v("notice", s?.default_notice_days)),
        onboardingChecklist: fromLines(
          String(v("onboarding", toLines(s?.onboarding_checklist))),
        ),
      }),
    onSuccess: () => {
      setError(null);
      setNotice("Settings saved.");
      setDraft(null);
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "hr"),
      });
    },
    onError: (e) => {
      setNotice(null);
      setError(e instanceof HrApiError ? e.message : "Could not save.");
    },
  });
  if (query.isError)
    return (
      <PermissionState
        title="You don't have access to HR settings"
        description="Ask an administrator to grant hr_payroll.settings.manage."
      />
    );
  if (!s) return <p className="text-sm text-text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="HR settings"
        description="Employee numbering, probation and notice defaults, and the onboarding checklist."
      />
      {notice && <HrAlert tone="success">{notice}</HrAlert>}
      {error && <HrAlert>{error}</HrAlert>}
      <HrPanel title="Numbering and defaults">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            label="Employee number prefix"
            value={String(v("prefix", s.employee_number_prefix))}
            onChange={(x) => set("prefix", x)}
          />
          <NumberField
            label="Number padding"
            value={Number(v("padding", s.employee_number_padding))}
            minValue={3}
            step={1}
            onChange={(x) => set("padding", x)}
          />
          <NumberField
            label="Default probation (months)"
            value={Number(v("probation", s.default_probation_months))}
            minValue={0}
            step={1}
            onChange={(x) => set("probation", x)}
          />
          <NumberField
            label="Default notice period (days)"
            value={Number(v("notice", s.default_notice_days))}
            minValue={0}
            step={1}
            onChange={(x) => set("notice", x)}
          />
        </div>
      </HrPanel>
      <HrPanel
        title="Onboarding checklist"
        description="One task per line. Add ' | Team' to name the owner. Leave empty to use the built-in list."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextArea
            label="Onboarding checklist"
            value={String(v("onboarding", toLines(s.onboarding_checklist)))}
            onChange={(x) => set("onboarding", x)}
          />
        </div>
      </HrPanel>
      {can("hr_payroll.settings.manage") && (
        <div>
          <Button
            variant="primary"
            onPress={() => save.mutate()}
            isLoading={save.isPending}
          >
            Save settings
          </Button>
        </div>
      )}
    </div>
  );
}
