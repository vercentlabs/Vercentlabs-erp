"use client";

// CRM › Campaign emails (CRM plan 5.8): one email to many leads or contacts. Write it, choose who gets it (only people who agreed to email
// and are not opted out), check the count, send now or at a time; then see how many were sent, opened, clicked and unsubscribed.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Badge, Button, Dialog, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { getLeadOptions } from "@/features/crm/leads/api/leads-api";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class MailingError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(MailingError, "body");
type Mailing = {
  id: string; name: string; audience: "leads" | "contacts"; filters: Record<string, string>; subject: string; body: string; status: string; scheduledAt: string | null;
  finishedAt: string | null; createdAt: string; counts: { recipients: number; sent: number; skipped: number; failed: number; opened: number; clicked: number; unsubscribed: number };
};
type Preview = { total: number; eligible: number; skipped: Record<string, number>; tooMany: boolean };
const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  draft: { label: "Draft", tone: "neutral" }, scheduled: { label: "Scheduled", tone: "info" }, sending: { label: "Sending", tone: "info" }, sent: { label: "Sent", tone: "success" },
  cancelled: { label: "Cancelled", tone: "warning" },
};
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export function MailingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "mailings");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ mailings: Mailing[] }>("/api/crm/mailings").then((result) => result.mailings), enabled: canManage, refetchInterval: 15_000 });
  const [editing, setEditing] = useState<Mailing | "new" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const act = useMutation({
    mutationFn: ({ id, action, scheduledAt }: { id: string; action: "schedule" | "cancel"; scheduledAt?: string }) =>
      request(`/api/crm/mailings/${id}/${action}`, { method: "POST", json: scheduledAt ? { scheduledAt } : {} }),
    onSuccess: refresh,
  });
  if (!canManage) return <PermissionState title="You can't send campaign emails" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading campaign emails" rows={4} />;
  if (query.isError) return <ErrorState title="Could not load campaign emails" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Campaign emails" description="One email to many leads or contacts — only those who agreed to email and have not opted out. Each email has an unsubscribe link."
        primaryAction={<Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New campaign email</Button>} />
      {act.isError && <Notice>{act.error instanceof Error ? act.error.message : "That did not work."}</Notice>}
      {(query.data ?? []).length === 0 ? <p className="text-sm text-text-secondary">No campaign emails yet.</p> : (
        <ul className="flex max-w-5xl flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {(query.data ?? []).map((mailing) => (
            <li key={mailing.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{mailing.name}</span>
                  <StatusBadge tone={STATUS[mailing.status]?.tone ?? "neutral"}>{STATUS[mailing.status]?.label ?? mailing.status}</StatusBadge>
                  <Badge tone="neutral">{mailing.audience === "leads" ? "Leads" : "Contacts"}</Badge>
                </div>
                <span className="text-text-secondary">{mailing.subject}</span>
                {mailing.status !== "draft" && (
                  <span className="text-xs text-text-muted">
                    {`${mailing.counts.sent} sent of ${mailing.counts.recipients - mailing.counts.skipped} · opened ${pct(mailing.counts.opened, mailing.counts.sent)} · clicked ${pct(mailing.counts.clicked, mailing.counts.sent)} · ${mailing.counts.unsubscribed} unsubscribed${mailing.counts.failed ? ` · ${mailing.counts.failed} failed` : ""}${mailing.counts.skipped ? ` · ${mailing.counts.skipped} skipped` : ""}`}
                    {mailing.scheduledAt && mailing.status === "scheduled" ? ` · goes ${formatDateTime(mailing.scheduledAt)}` : ""}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {mailing.status === "draft" && <Button variant="ghost" size="compact" onPress={() => setEditing(mailing)}>Edit and send</Button>}
                {["draft", "scheduled", "sending"].includes(mailing.status) && <Button variant="ghost" size="compact" isDisabled={act.isPending} onPress={() => act.mutate({ id: mailing.id, action: "cancel" })}>Cancel</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <MailingDialog mailing={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </div>
  );
}

function MailingDialog({ mailing, onClose, onDone }: { mailing: Mailing | null; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 });
  const [name, setName] = useState(mailing?.name ?? "");
  const [audience, setAudience] = useState<"leads" | "contacts">(mailing?.audience ?? "leads");
  const [filters, setFilters] = useState<Record<string, string>>(mailing?.filters ?? {});
  const [subject, setSubject] = useState(mailing?.subject ?? "");
  const [body, setBody] = useState(mailing?.body ?? "Dear {{first_name}},\n\n");
  const [when, setWhen] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setFilter = (key: string) => (value: string) => setFilters((current) => { const next = { ...current }; if (!value || value === "any") delete next[key]; else next[key] = value; return next; });
  const check = useMutation({
    mutationFn: () => request<{ preview: Preview }>("/api/crm/mailings/preview", { method: "POST", json: { audience, filters } }).then((result) => result.preview),
    onSuccess: setPreview, onError: (failure) => setError(failure instanceof Error ? failure.message : "The audience could not be counted."),
  });
  const save = useMutation({
    mutationFn: async (send: boolean) => {
      const input = { name, audience, filters, subject, body };
      const saved = mailing
        ? (await request<{ mailing: Mailing }>(`/api/crm/mailings/${mailing.id}`, { method: "PATCH", json: input })).mailing
        : (await request<{ mailing: Mailing }>("/api/crm/mailings", { method: "POST", json: input })).mailing;
      if (send) await request(`/api/crm/mailings/${saved.id}/schedule`, { method: "POST", json: when ? { scheduledAt: new Date(when).toISOString() } : {} });
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The campaign email could not be saved."),
  });
  const any = (list: Array<{ value: string; label: string }>, label: string) => [{ value: "any", label }, ...list];
  const ready = name.trim() && subject.trim() && body.trim();
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={mailing ? `Edit ${mailing.name}` : "New campaign email"} size="xl">
      <div className="flex flex-col gap-4">
        {error && <Notice>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" description="For you; the recipients see the subject." isRequired value={name} onChange={setName} maxLength={120} />
          <Select label="Send to" selectedKey={audience} onSelectionChange={(key) => { setAudience(String(key) as "leads" | "contacts"); setFilters({}); setPreview(null); }}
            options={[{ value: "leads", label: "Leads" }, { value: "contacts", label: "Contacts" }]} />
        </div>
        <fieldset className="grid gap-3 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">Who (optional filters)</legend>
          {audience === "leads" ? (
            <>
              <Select label="Status" size="compact" selectedKey={filters.status ?? "any"} onSelectionChange={(key) => setFilter("status")(String(key))}
                options={any([{ value: "open", label: "Open" }, { value: "qualified", label: "Qualified" }, { value: "disqualified", label: "Disqualified" }], "Any status")} />
              <Select label="Source" size="compact" selectedKey={filters.sourceId ?? "any"} onSelectionChange={(key) => setFilter("sourceId")(String(key))}
                options={any((options.data?.sources ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
              <Select label="Tag" size="compact" selectedKey={filters.tagId ?? "any"} onSelectionChange={(key) => setFilter("tagId")(String(key))}
                options={any((options.data?.tags ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any tag")} />
              <Select label="Campaign" size="compact" selectedKey={filters.campaignId ?? "any"} onSelectionChange={(key) => setFilter("campaignId")(String(key))}
                options={any((options.data?.campaigns ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any campaign")} />
              <TextField label="State" size="compact" value={filters.state ?? ""} onChange={setFilter("state")} />
              <TextField label="City" size="compact" value={filters.city ?? ""} onChange={setFilter("city")} />
            </>
          ) : <TextField label="City" size="compact" value={filters.city ?? ""} onChange={setFilter("city")} />}
          <div className="flex items-end gap-2 sm:col-span-3">
            <Button variant="secondary" size="compact" isLoading={check.isPending} onPress={() => check.mutate()}>Count who gets it</Button>
            {preview && (
              <span className="text-sm">
                {`${preview.eligible} of ${preview.total} will receive it.`}
                {Object.entries(preview.skipped).length > 0 && <span className="text-text-secondary">{` Left out: ${Object.entries(preview.skipped).map(([reason, count]) => `${reason} (${count})`).join(", ")}.`}</span>}
              </span>
            )}
          </div>
        </fieldset>
        <TextField label="Subject" isRequired value={subject} onChange={setSubject} maxLength={300} />
        <TextArea label="Message" isRequired rows={10} value={body} onChange={setBody}
          description="Plain text. {{first_name}}, {{last_name}}, {{name}} and {{company}} are filled in; web links are counted when followed; an unsubscribe line is added." />
        <DateTimeInput label="Send at (optional)" description="Empty: as soon as you press Send." value={when} onChange={setWhen} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="secondary" isLoading={save.isPending} isDisabled={!ready} onPress={() => save.mutate(false)}>Save draft</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!ready} onPress={() => save.mutate(true)}>{when ? "Schedule" : "Send"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
