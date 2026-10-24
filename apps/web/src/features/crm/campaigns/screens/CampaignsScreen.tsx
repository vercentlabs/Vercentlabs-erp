"use client";

// CRM › Setup › Campaigns (CRM plan 3.4): what the business ran to bring leads in, and what came of each — its leads, how many were
// converted, its deals, those won and the value won (in the base currency), against its budget: the cost of a lead and the return on the
// budget. A campaign runs, is upcoming or has ended by its dates; archived, it is no longer offered for new leads, and the leads and deals
// that name it keep it. A tracking link (utm_campaign = its code) makes web-form leads name it by themselves.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Copy, Link2, Pencil, Plus, RotateCcw } from "lucide-react";
import { Button, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, SearchField, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";
import { CRM_MEDIUMS, crmMediumLabel } from "@vercentlabs/shared-types";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { UnconvertedNotice } from "@/features/crm/shared/ui/UnconvertedNotice";
import { createCampaign, errorMessage, listCampaigns, setCampaignStatus, updateCampaign, type Campaign } from "@/features/crm/shared/marketing-api";
import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const NONE = "";
type State = "running" | "upcoming" | "ended" | "archived";
const STATE_LABEL: Record<State, string> = { running: "Running", upcoming: "Upcoming", ended: "Ended", archived: "Archived" };
const STATE_TONE: Record<State, "success" | "info" | "neutral" | "warning"> = { running: "success", upcoming: "info", ended: "neutral", archived: "neutral" };
const VIEWS = [{ id: "active", label: "Active" }, { id: "archived", label: "Archived" }, { id: "all", label: "All" }] as const;
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
function stateOf(campaign: Campaign): State {
  if (campaign.status === "archived") return "archived";
  if (campaign.endsOn && campaign.endsOn < today()) return "ended";
  if (campaign.startsOn && campaign.startsOn > today()) return "upcoming";
  return "running";
}
const runs = (campaign: Campaign) => (campaign.startsOn || campaign.endsOn
  ? `${campaign.startsOn ? formatDate(campaign.startsOn) : "Open start"} – ${campaign.endsOn ? formatDate(campaign.endsOn) : "no end date"}` : "No dates set");

// What a campaign brought for its budget (when the budget is in the reporting currency): the cost of a lead and the won value per rupee spent.
function results(campaign: Campaign, currency: string | null) {
  const stats = campaign.stats ?? { leads: 0, convertedLeads: 0, deals: 0, openDeals: 0, wonDeals: 0, wonValue: 0 };
  const comparable = campaign.budget !== null && campaign.budget > 0 && (!campaign.currencyCode || campaign.currencyCode === currency);
  return {
    stats,
    costPerLead: comparable && stats.leads > 0 ? campaign.budget! / stats.leads : null,
    multiple: comparable ? stats.wonValue / campaign.budget! : null,
  };
}
const multipleText = (value: number | null) => (value === null ? "—" : `${value >= 10 ? Math.round(value) : value.toFixed(1)}×`);

export function CampaignsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "campaigns");
  const query = useQuery({ queryKey: key, queryFn: listCampaigns, enabled: canManage });
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const [linking, setLinking] = useState<Campaign | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-options") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options") });
  };
  const toggle = useMutation({
    mutationFn: (row: Campaign) => setCampaignStatus(row.id, row.status === "active" ? "archived" : "active"),
    onSuccess: (row) => { setNotice({ tone: "success", text: row.status === "archived" ? `Archived ${row.name}: no longer offered for new leads.` : `Restored ${row.name}.` }); refresh(); },
    onError: (failure) => setNotice({ tone: "danger", text: errorMessage(failure) }),
  });
  const currency = query.data?.currency.reportingCurrency ?? null;
  const all = useMemo(() => query.data?.campaigns ?? [], [query.data]);
  const rows = useMemo(() => all.filter((campaign) => (view === "all" || (view === "archived" ? campaign.status === "archived" : campaign.status === "active"))
    && `${campaign.name} ${campaign.code ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())), [all, view, search]);
  const totals = useMemo(() => {
    const budget = rows.reduce((sum, row) => sum + (row.budget !== null && (!row.currencyCode || row.currencyCode === currency) ? row.budget : 0), 0);
    const won = rows.reduce((sum, row) => sum + (row.stats?.wonValue ?? 0), 0);
    return { leads: rows.reduce((sum, row) => sum + (row.stats?.leads ?? 0), 0), wonDeals: rows.reduce((sum, row) => sum + (row.stats?.wonDeals ?? 0), 0), won, budget, multiple: budget > 0 ? won / budget : null };
  }, [rows, currency]);
  const money = (value: number) => (currency ? formatMoney(currency, value) : String(value));
  const actions = (row: Campaign) => (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="secondary" size="compact" aria-label={`Edit ${row.name}`} onPress={() => { setNotice(null); setEditing(row); }}><Pencil className="size-3.5" aria-hidden="true" />Edit</Button>
      {row.status === "active" && <Button variant="ghost" size="compact" aria-label={`Tracking link for ${row.name}`} onPress={() => setLinking(row)}><Link2 className="size-3.5" aria-hidden="true" />Link</Button>}
      <Button variant="ghost" size="compact" aria-label={`${row.status === "active" ? "Archive" : "Restore"} ${row.name}`} isDisabled={toggle.isPending} onPress={() => toggle.mutate(row)}>
        {row.status === "active" ? <><Archive className="size-3.5" aria-hidden="true" />Archive</> : <><RotateCcw className="size-3.5" aria-hidden="true" />Restore</>}
      </Button>
    </div>
  );

  if (!canManage) return <PermissionState title="You can't manage campaigns" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="Campaigns" description="What you ran to bring leads in, and what came of it. Leads name their campaign; the deals they become keep it." />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {query.data && <UnconvertedNotice currency={query.data.currency} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div role="group" aria-label="Show" className="flex gap-1 rounded-[var(--radius-control)] border border-border bg-surface p-1">
          {VIEWS.map((entry) => (
            <Button key={entry.id} size="compact" variant={view === entry.id ? "primary" : "ghost"} aria-pressed={view === entry.id} className="flex-1 sm:flex-none"
              onPress={() => setView(entry.id)}>{entry.label}</Button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:flex-1">
          <SearchField aria-label="Find a campaign" placeholder="Find a campaign" className="min-w-0 flex-1 sm:max-w-xs" value={search} onChange={setSearch} />
          <Button variant="primary" className="ml-auto shrink-0" onPress={() => { setNotice(null); setEditing("new"); }}><Plus className="size-4" aria-hidden="true" />New campaign</Button>
        </div>
      </div>

      {query.isLoading ? <LoadingState label="Loading campaigns" rows={4} /> : query.isError ? (
        <ErrorState title="Could not load the campaigns" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />
      ) : all.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Add what you run, such as an expo, a Diwali offer or a Google Ads drive, to see what each brings in." />
      ) : rows.length === 0 ? <p className="text-sm text-text-secondary">No campaign here matches.</p> : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[["Leads", totals.leads.toLocaleString("en-IN")], ["Deals won", totals.wonDeals.toLocaleString("en-IN")], ["Won value", money(totals.won)],
              ["Return on budget", totals.multiple === null ? "No budget set" : `${multipleText(totals.multiple)} of ${money(totals.budget)}`]].map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
                <dt className="text-xs text-text-muted">{label}</dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          {/* Desktop: a row per campaign. */}
          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface xl:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs text-text-secondary">
                <tr>
                  <th className="px-4 py-2 font-medium">Campaign</th><th className="px-3 py-2 text-right font-medium">Leads</th><th className="px-3 py-2 text-right font-medium">Deals</th>
                  <th className="px-3 py-2 text-right font-medium">Won value</th><th className="px-3 py-2 text-right font-medium">Budget</th>
                  <th className="px-3 py-2 text-right font-medium">Per lead</th><th className="px-3 py-2 text-right font-medium">Return</th><th className="px-3 py-2 font-medium">State</th>
                  <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const result = results(row, currency);
                  const state = stateOf(row);
                  return (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-3">
                        <span className="flex flex-col gap-0.5">
                          <span className="font-medium">{row.name}</span>
                          <span className="text-xs text-text-muted">{[row.code, crmMediumLabel(row.medium), runs(row)].filter(Boolean).join(" · ")}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums"><Leads row={row} /></td>
                      <td className="px-3 py-3 text-right tabular-nums"><Deals row={row} /></td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(result.stats.wonValue)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.budget !== null ? formatMoney(row.currencyCode ?? currency ?? "INR", row.budget) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{result.costPerLead === null ? "—" : money(Math.round(result.costPerLead))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{multipleText(result.multiple)}</td>
                      <td className="px-3 py-3"><StatusBadge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</StatusBadge></td>
                      <td className="px-4 py-3">{actions(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Tablet and phone: a card per campaign (two across on a tablet). */}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:hidden">
            {rows.map((row) => {
              const result = results(row, currency);
              const state = stateOf(row);
              return (
                <li key={row.id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-xs text-text-muted">{[row.code, crmMediumLabel(row.medium)].filter(Boolean).join(" · ") || "No code or medium"}</span>
                      <span className="text-xs text-text-muted">{runs(row)}</span>
                    </span>
                    <StatusBadge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</StatusBadge>
                  </div>
                  <dl className="grid grid-cols-3 divide-x divide-border rounded-[var(--radius-control)] border border-border bg-surface-muted text-center">
                    <div className="px-1 py-2"><dt className="text-[11px] text-text-muted">Leads</dt><dd className="text-sm font-semibold tabular-nums"><Leads row={row} short /></dd></div>
                    <div className="px-1 py-2"><dt className="text-[11px] text-text-muted">Deals</dt><dd className="text-sm font-semibold tabular-nums"><Deals row={row} short /></dd></div>
                    <div className="px-1 py-2"><dt className="text-[11px] text-text-muted">Won</dt><dd className="truncate text-sm font-semibold tabular-nums">{money(result.stats.wonValue)}</dd></div>
                  </dl>
                  <p className="text-xs text-text-secondary">
                    {row.budget !== null ? `Budget ${formatMoney(row.currencyCode ?? currency ?? "INR", row.budget)}` : "No budget set"}
                    {result.costPerLead !== null ? ` · ${money(Math.round(result.costPerLead))} a lead` : ""}
                    {result.multiple !== null ? ` · return ${multipleText(result.multiple)}` : ""}
                  </p>
                  {actions(row)}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {editing && <CampaignDialog campaign={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={(saved, created) => { setEditing(null); setNotice({ tone: "success", text: created ? `Added ${saved.name}.` : `Saved ${saved.name}.` }); refresh(); }} />}
      {linking && <TrackingLinkDialog campaign={linking} onClose={() => setLinking(null)} />}
    </div>
  );
}

function Leads({ row, short = false }: { row: Campaign; short?: boolean }) {
  const leads = row.stats?.leads ?? 0;
  const converted = row.stats?.convertedLeads ?? 0;
  if (!leads) return <span className="text-text-muted">0</span>;
  return (
    <Link className="text-brand hover:underline" href={`/crm/leads?view=all&campaignId=${row.id}`}>
      {leads}{converted ? <span className="font-normal text-text-muted">{short ? ` (${converted} conv.)` : ` (${converted} converted)`}</span> : null}
    </Link>
  );
}

function Deals({ row, short = false }: { row: Campaign; short?: boolean }) {
  const deals = row.stats?.deals ?? 0;
  const won = row.stats?.wonDeals ?? 0;
  if (!deals) return <span className="text-text-muted">0</span>;
  return (
    <Link className="text-brand hover:underline" href={`/crm/opportunities?view=all&campaignId=${row.id}`}>
      {deals}{won ? <span className="font-normal text-text-muted">{` (${won} won${!short && row.stats?.openDeals ? `, ${row.stats.openDeals} open` : ""})`}</span> : null}
    </Link>
  );
}

// A link to put in an ad, email or post: a web-form lead that arrives through it names this campaign (and its medium) by itself.
function TrackingLinkDialog({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [page, setPage] = useState("");
  const [source, setSource] = useState("");
  const [copied, setCopied] = useState(false);
  const value = campaign.code ?? campaign.name.toLowerCase();
  const link = (() => {
    try {
      const url = new URL(page.trim().startsWith("http") ? page.trim() : `https://${page.trim()}`);
      url.searchParams.set("utm_campaign", value);
      if (campaign.medium) url.searchParams.set("utm_medium", campaign.medium);
      if (source.trim()) url.searchParams.set("utm_source", source.trim().toLowerCase());
      return page.trim() ? url.toString() : null;
    } catch {
      return null;
    }
  })();
  const copy = async () => { if (!link) return; try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } };
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`Tracking link · ${campaign.name}`}
      description="Leads from your web form that arrive through this link are put on this campaign by themselves." size="lg">
      <div className="flex flex-col gap-4">
        {!campaign.code && <Notice tone="info">This campaign has no code, so the link uses its name. Give it a short code (Edit) for a neater link.</Notice>}
        <TextField label="Page with your enquiry form" placeholder="https://www.yourcompany.com/contact" value={page} onChange={(next) => { setPage(next); setCopied(false); }} />
        <TextField label="Where you post it (optional)" placeholder="google, facebook, newsletter" value={source} onChange={(next) => { setSource(next); setCopied(false); }}
          description="Sent as utm_source." />
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface-muted p-3">
          <span className="text-xs font-medium text-text-secondary">Your link</span>
          <span className="break-all font-mono text-xs">{link ?? "Enter the page address above."}</span>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isDisabled={!link} onPress={() => void copy()}><Copy className="size-4" aria-hidden="true" />{copied ? "Copied" : "Copy link"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function CampaignDialog({ campaign, onClose, onSaved }: { campaign: Campaign | null; onClose: () => void; onSaved: (saved: Campaign, created: boolean) => void }) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [code, setCode] = useState(campaign?.code ?? "");
  const [medium, setMedium] = useState(campaign?.medium ?? NONE);
  const [startsOn, setStartsOn] = useState(campaign?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(campaign?.endsOn ?? "");
  const [budget, setBudget] = useState(campaign?.budget !== null && campaign?.budget !== undefined ? String(campaign.budget) : "");
  const [description, setDescription] = useState(campaign?.description ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const input = { name, code: code.trim() || null, medium: medium || null, startsOn: startsOn || null, endsOn: endsOn || null, budget: budget.trim() || null, description: description.trim() || null };
      return campaign ? updateCampaign(campaign.id, input) : createCampaign(input);
    },
    onSuccess: (saved) => onSaved(saved, !campaign),
    onError: (failure) => {
      const issues = (failure as { details?: { issues?: Array<{ field: string; message: string }> } }).details?.issues ?? [];
      setErrors({ form: errorMessage(failure), ...Object.fromEntries(issues.map((issue) => [issue.field, issue.message])) });
    },
  });
  const datesWrong = Boolean(startsOn && endsOn && startsOn > endsOn);
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={campaign ? `Edit ${campaign.name}` : "New campaign"} size="lg">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !datesWrong) save.mutate(); }}>
        {errors.form && Object.keys(errors).length === 1 && <Notice>{errors.form}</Notice>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Name" isRequired value={name} onChange={setName} isInvalid={Boolean(errors.name)} errorMessage={errors.name} />
          <TextField label="Code (optional)" value={code} onChange={(value) => setCode(value.toLowerCase().replace(/\s+/g, "-"))} isInvalid={Boolean(errors.code)} errorMessage={errors.code}
            description="utm_campaign in your links, such as diwali-2026." />
          <Select label="Usual medium" selectedKey={medium} onSelectionChange={(value) => setMedium(String(value ?? NONE))}
            options={[{ value: NONE, label: "Not set" }, ...CRM_MEDIUMS.map((entry) => ({ value: entry.code, label: entry.label }))]} />
          <TextField label="Budget (optional)" inputMode="decimal" value={budget} onChange={(value) => setBudget(value.replace(/[^0-9.]/g, ""))} isInvalid={Boolean(errors.budget)} errorMessage={errors.budget}
            description="What you spend on it, for the cost of a lead and the return." />
          <TextField label="Starts on" type="date" value={startsOn} onChange={setStartsOn} isInvalid={Boolean(errors.startsOn)} errorMessage={errors.startsOn} />
          <TextField label="Ends on" type="date" value={endsOn} onChange={setEndsOn} isInvalid={datesWrong || Boolean(errors.endsOn)}
            errorMessage={datesWrong ? "The end date is before the start date." : errors.endsOn} />
        </div>
        <TextArea label="Description" value={description} onChange={setDescription} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={save.isPending} isDisabled={!name.trim() || datesWrong || save.isPending}>{campaign ? "Save" : "Create campaign"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
