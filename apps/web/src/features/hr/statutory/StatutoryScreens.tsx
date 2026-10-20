"use client";

// HR & Payroll — Statutory rules (EPF, ESI, Professional Tax by state, TDS on salaries) as verified, versioned rules; opening year-to-date pay;
// and variable pay. A rule is a draft until someone other than its author verifies it against the law; payroll uses only active versions.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, Select, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { errorMessage } from "@/features/quality/specifications/spec-api";
import { formatDateTime } from "@/shared/format/human";
import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Option = { value: string; label: string };
type Rule = { id: string; family: string; version: number; type: string; typeLabel: string; name: string; state: string | null; stateLabel: string | null; status: string;
  effectiveFrom: string; effectiveTo: string | null; configuration: Record<string, unknown>; source: string | null; verifiedBy: string | null; verifiedAt: string | null;
  verificationNote: string | null; createdBy: string | null };
type Template = { key: string; name: string; type: string; state: string | null; source: string; configuration: Record<string, unknown> };
type Ytd = { id: string; employee: { id: string; number: string; name: string }; financialYear: string; source: string; employerName: string | null; gross: number; taxable: number; tds: number };
type StatutoryData = { rules: Rule[]; templates: Template[]; ytd: Ytd[]; employees: Option[] };
type Input = { id: string; employee: { id: string; number: string; name: string }; type: string; typeLabel: string; kind: string; code: string; amount: number; taxable: boolean;
  description: string; month: string; status: string; requestedBy: string | null; decidedBy: string | null; decisionNote: string | null; run: string | null };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/hr${path}`, { credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "The request could not be completed.");
  return payload as T;
}
const post = (path: string, body: Record<string, unknown>) => call(path, { method: "POST", body: JSON.stringify(body) });
const money = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { DRAFT: "warning", ACTIVE: "success", RETIRED: "neutral", pending_approval: "warning", approved: "success",
  rejected: "danger", cancelled: "neutral", paid: "info" };

export function StatutoryRulesScreen() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const key = scopedQueryKey(workspace, "hr", "statutory");
  const [tab, setTab] = useState("rules");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: key, queryFn: () => call<StatutoryData>("/statutory"), retry: false });
  if (q.isLoading) return <LoadingState label="Loading the statutory rules" rows={4} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  const run = async (body: Record<string, unknown>) => { setError(null); try { await post("/statutory", body); await client.invalidateQueries({ queryKey: key }); } catch (e) { setError(errorMessage(e)); throw e; } };
  const createAsk: Ask = { title: "New rule version from a template", confirm: "Create draft",
    description: "A template is a starting point, not the law: check every figure against the act, notification or circular before you verify it. The draft is not used by payroll until verified.",
    fields: [{ name: "template", label: "Template", kind: "select", required: true, options: d.templates.map((t) => ({ value: t.key, label: t.name })) },
      { name: "effectiveFrom", label: "Applies from", kind: "date", required: true }, { name: "effectiveTo", label: "Applies until (optional)", kind: "date" }],
    run: async (v) => { await run({ action: "create", ...v, effectiveTo: v.effectiveTo || undefined }); } };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Statutory Rules" description="EPF, ESI, Professional Tax by state and TDS on salaries — as versions with effective dates, verified by someone other than their author before payroll uses them. Old-regime TDS and surcharge are not calculated: payroll stops for them and asks for a monthly TDS amount."
        primaryAction={<Button variant="primary" onPress={() => setAsk(createAsk)}>New rule version</Button>} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))}>
        <TabList aria-label="Statutory sections"><Tab id="rules">Rule versions</Tab><Tab id="ytd">Opening year-to-date pay</Tab></TabList>
      </Tabs>
      {tab === "rules" && <LinesTable columns={["Rule", "Version", "Applies", "Configuration", "Source", "Verified", "Status", ""]} empty={d.rules.length ? undefined : "No statutory rules yet. Create them from the templates and have them verified."}>
        {d.rules.map((r) => <tr key={r.id}><Cell>{r.name}<span className="block text-xs text-text-muted">{r.family}{r.stateLabel ? ` · ${r.stateLabel}` : ""}</span></Cell><Cell numeric>{r.version}</Cell>
          <Cell>{`${String(r.effectiveFrom).slice(0, 10)} → ${r.effectiveTo ? String(r.effectiveTo).slice(0, 10) : "open"}`}</Cell>
          <Cell><code className="block max-w-xs whitespace-pre-wrap text-xs">{JSON.stringify(r.configuration)}</code></Cell><Cell><span className="text-xs">{r.source ?? "—"}</span></Cell>
          <Cell>{r.verifiedBy ? `${r.verifiedBy}, ${r.verifiedAt ? formatDateTime(r.verifiedAt) : ""}` : "—"}{r.verificationNote && <span className="block text-xs text-text-muted">{r.verificationNote}</span>}</Cell>
          <Cell><StatusBadge tone={TONE[r.status] ?? "neutral"}>{r.status === "DRAFT" ? "Draft — not used" : r.status === "ACTIVE" ? "Active" : "Retired"}</StatusBadge></Cell>
          <Cell>{r.status === "DRAFT" && <Button size="compact" variant="primary" onPress={() => setAsk({ title: `Verify ${r.family} v${r.version}`, confirm: "Verify and activate",
            description: `Check the configuration against the law in force from ${String(r.effectiveFrom).slice(0, 10)}. You can't verify a version you created.`,
            fields: [{ name: "note", label: "What you verified it against", kind: "textarea", required: true }], run: async (v) => { await run({ action: "verify", id: r.id, ...v }); } })}>Verify</Button>}
            {r.status === "ACTIVE" && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: `Retire ${r.family} v${r.version}`, confirm: "Retire",
              fields: [{ name: "from", label: "Stops applying from", kind: "date", required: true }, { name: "reason", label: "Reason", kind: "textarea", required: true }],
              run: async (v) => { await run({ action: "retire", id: r.id, ...v }); } })}>Retire</Button>}</Cell></tr>)}
      </LinesTable>}
      {tab === "ytd" && <Panel title="Opening year-to-date pay" description="Earnings and tax already paid this financial year before this payroll (moving from another system, or a previous employer's Form 16 / 12B). TDS uses them for the year's projection."
        actions={<Button size="compact" variant="primary" onPress={() => setAsk({ title: "Opening year-to-date pay", confirm: "Save",
          fields: [{ name: "employeeId", label: "Employee", kind: "select", required: true, options: d.employees }, { name: "financialYear", label: "Financial year (e.g. 2026-27)", kind: "text", required: true },
            { name: "source", label: "From", kind: "select", initial: "CUT_OVER", options: [{ value: "CUT_OVER", label: "Our earlier system" }, { value: "PREVIOUS_EMPLOYER", label: "A previous employer" }] },
            { name: "employerName", label: "Previous employer", kind: "text" }, { name: "gross", label: "Gross earnings", kind: "quantity", required: true },
            { name: "taxable", label: "Taxable earnings", kind: "quantity", required: true }, { name: "tds", label: "TDS deducted", kind: "quantity", required: true }],
          run: async (v) => { await run({ action: "ytd", ...v }); } })}>Add</Button>}>
        <LinesTable columns={["Employee", "Year", "From", { label: "Gross", numeric: true }, { label: "Taxable", numeric: true }, { label: "TDS", numeric: true }]} empty={d.ytd.length ? undefined : "None recorded."}>
          {d.ytd.map((y) => <tr key={y.id}><Cell>{`${y.employee.number} · ${y.employee.name}`}</Cell><Cell>{y.financialYear}</Cell><Cell>{y.source === "PREVIOUS_EMPLOYER" ? `Previous employer${y.employerName ? `: ${y.employerName}` : ""}` : "Cut-over"}</Cell>
            <Cell numeric>{money(y.gross)}</Cell><Cell numeric>{money(y.taxable)}</Cell><Cell numeric>{money(y.tds)}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

export function VariablePayScreen() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = scopedQueryKey(workspace, "hr", "variable-pay", month, status);
  const q = useQuery({ queryKey: key, queryFn: () => call<{ rows: Input[]; employees: Option[] }>(`/variable-pay?month=${encodeURIComponent(month)}&status=${encodeURIComponent(status)}`), retry: false });
  if (q.isLoading) return <LoadingState label="Loading variable pay" rows={4} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  const run = async (body: Record<string, unknown>) => { setError(null); try { await post("/variable-pay", body); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr", "variable-pay") }); } catch (e) { setError(errorMessage(e)); throw e; } };
  const TYPES = [["bonus", "Bonus"], ["incentive", "Incentive"], ["allowance", "Allowance"], ["arrear", "Arrear"], ["deduction", "Deduction"], ["recovery", "Recovery"]].map(([value, label]) => ({ value, label }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Variable Pay" description="One-time earnings and deductions for a pay month. Entered by one person, approved by another, and paid once by that month's payroll. A monthly TDS amount under the old regime is a deduction with code TDS."
        primaryAction={<Button variant="primary" onPress={() => setAsk({ title: "Add variable pay", confirm: "Add",
          fields: [{ name: "employeeId", label: "Employee", kind: "select", required: true, options: d.employees }, { name: "type", label: "Kind", kind: "select", required: true, initial: "bonus", options: TYPES },
            { name: "amount", label: "Amount", kind: "quantity", required: true }, { name: "month", label: "Pay month (e.g. 2026-10)", kind: "text", required: true },
            { name: "description", label: "What it is for", kind: "text", required: true }, { name: "code", label: "Code on the payslip (optional; TDS for old-regime tax)", kind: "text" },
            { name: "taxable", label: "Taxable (earnings)", kind: "checkbox", initial: true }],
          run: async (v) => { await run({ action: "create", ...v }); } })}>Add variable pay</Button>} />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-wrap items-end gap-2"><TextField label="Month" value={month} onChange={setMonth} description="e.g. 2026-10" />
        <Select label="Status" selectedKey={status || "any"} onSelectionChange={(k) => setStatus(k === "any" ? "" : String(k))}
          options={[{ value: "any", label: "Any" }, { value: "pending_approval", label: "Awaiting approval" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "paid", label: "Paid" }]} /></div>
      <LinesTable columns={["Employee", "Month", "Kind", "What", { label: "Amount", numeric: true }, "Entered / decided", "Payroll", "Status", ""]} empty={d.rows.length ? undefined : "Nothing here."}>
        {d.rows.map((r) => <tr key={r.id}><Cell>{`${r.employee.number} · ${r.employee.name}`}</Cell><Cell>{r.month}</Cell><Cell>{r.typeLabel}<span className="block text-xs text-text-muted">{r.code}{r.kind === "earning" && r.taxable ? " · taxable" : ""}</span></Cell>
          <Cell>{r.description}</Cell><Cell numeric>{money(r.amount)}</Cell><Cell>{r.requestedBy ?? "—"}{r.decidedBy && <span className="block text-xs text-text-muted">{`${r.decidedBy}${r.decisionNote ? `: ${r.decisionNote}` : ""}`}</span>}</Cell>
          <Cell>{r.run ?? "—"}</Cell><Cell><StatusBadge tone={TONE[r.status] ?? "neutral"}>{r.status.replace(/_/g, " ")}</StatusBadge></Cell>
          <Cell>{r.status === "pending_approval" && <span className="flex gap-1"><Button size="compact" variant="primary" onPress={() => { run({ action: "approve", id: r.id }).catch(() => undefined); }}>Approve</Button>
            <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Reject", confirm: "Reject", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }], run: async (v) => { await run({ action: "reject", id: r.id, ...v }); } })}>Reject</Button></span>}
            {["pending_approval", "approved"].includes(r.status) && !r.run && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Cancel", confirm: "Cancel item", tone: "danger", fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }],
              run: async (v) => { await run({ action: "cancel", id: r.id, ...v }); } })}>Cancel</Button>}</Cell></tr>)}
      </LinesTable>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
