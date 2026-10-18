"use client";

// CRM › Setup › Campaigns (CRM plan 3.4): what the business ran to bring leads in, and what came of each — its leads, how many were
// converted, its deals, those won and the value won (in the base currency), against its budget. Archived, a campaign is no longer offered
// for new leads; the leads and deals that name it keep it.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";
import { CRM_MEDIUMS, crmMediumLabel } from "@vercentlabs/shared-types";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { UnconvertedNotice } from "@/features/crm/shared/ui/UnconvertedNotice";
import { createCampaign, errorMessage, listCampaigns, setCampaignStatus, updateCampaign, type Campaign } from "@/features/crm/shared/marketing-api";
import { formatDate, formatMoney } from "@/shared/format/human";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const NONE = "";

export function CampaignsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "campaigns");
  const query = useQuery({ queryKey: key, queryFn: listCampaigns, enabled: canManage });
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-options") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options") });
  };
  const toggle = useMutation({
    mutationFn: (row: Campaign) => setCampaignStatus(row.id, row.status === "active" ? "archived" : "active"),
    onSuccess: () => { setError(null); refresh(); }, onError: (failure) => setError(errorMessage(failure)),
  });
  const currency = query.data?.currency.reportingCurrency ?? null;
  const rows = query.data?.campaigns ?? [];
  const columns = useMemo<ColumnDef<Campaign, unknown>[]>(() => [
    { id: "name", header: "Campaign", cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium">{row.original.name}</span>
        <span className="text-xs text-text-muted">{[row.original.code, crmMediumLabel(row.original.medium)].filter(Boolean).join(" · ")}</span>
      </span>
    ) },
    { id: "dates", header: "Runs", cell: ({ row }) => [row.original.startsOn && formatDate(row.original.startsOn), row.original.endsOn && formatDate(row.original.endsOn)].filter(Boolean).join(" – ") },
    { id: "leads", header: "Leads", cell: ({ row }) => (
      <Link className="tabular-nums hover:underline" href={`/crm/leads?view=all&campaignId=${row.original.id}`} onClick={(event) => event.stopPropagation()}>
        {row.original.stats?.leads ?? 0}{row.original.stats?.convertedLeads ? ` (${row.original.stats.convertedLeads} converted)` : ""}
      </Link>
    ) },
    { id: "deals", header: "Deals", cell: ({ row }) => (
      <Link className="tabular-nums hover:underline" href={`/crm/opportunities?view=all&campaignId=${row.original.id}`} onClick={(event) => event.stopPropagation()}>
        {row.original.stats?.deals ?? 0}{row.original.stats?.wonDeals ? ` (${row.original.stats.wonDeals} won)` : ""}
      </Link>
    ) },
    { id: "won", header: "Won value", cell: ({ row }) => <span className="tabular-nums">{currency ? formatMoney(currency, row.original.stats?.wonValue ?? 0) : ""}</span> },
    { id: "budget", header: "Budget", cell: ({ row }) => <span className="tabular-nums">{row.original.budget !== null ? formatMoney(row.original.currencyCode ?? currency ?? "INR", row.original.budget) : ""}</span> },
    { id: "state", header: "State", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? "Active" : "Archived"}</StatusBadge> },
  ], [currency]);

  if (!canManage) return <PermissionState title="You can't manage campaigns" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-4">
      <SetupBackLink />
      {error && <Notice>{error}</Notice>}
      {query.data && <UnconvertedNotice currency={query.data.currency} />}
      <EnterpriseListPage
        header={{
          title: "Campaigns",
          description: "What you ran to bring leads in, and what came of it. Leads name their campaign; the deals they become keep it.",
          primaryAction: <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New campaign</Button>,
        }}
      >
        <EnterpriseDataGrid<Campaign>
          aria-label="Campaigns"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={(row) => setEditing(row)}
          {...gridStates(query, rows.length, "campaigns", { title: "No campaigns", description: "Add the campaigns you run — an expo, a Diwali offer, a Google Ads drive — to see what each brings in." })}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()}>
              <MoreMenu label={`Actions for ${row.name}`} items={[
                { id: "edit", label: "Edit", onAction: () => setEditing(row) },
                { id: "state", label: row.status === "active" ? "Archive" : "Restore", isDisabled: toggle.isPending, onAction: () => toggle.mutate(row) },
              ]} />
            </span>
          )}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{row.name}</span>
              <span className="text-xs text-text-muted">{row.stats?.leads ?? 0} leads · {row.stats?.wonDeals ?? 0} won{currency ? ` · ${formatMoney(currency, row.stats?.wonValue ?? 0)}` : ""}{row.status === "archived" ? " · archived" : ""}</span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {editing && <CampaignDialog campaign={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function CampaignDialog({ campaign, onClose, onSaved }: { campaign: Campaign | null; onClose: () => void; onSaved: () => void }) {
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
    onSuccess: onSaved,
    onError: (failure) => {
      const issues = (failure as { details?: { issues?: Array<{ field: string; message: string }> } }).details?.issues ?? [];
      setErrors({ form: errorMessage(failure), ...Object.fromEntries(issues.map((issue) => [issue.field, issue.message])) });
    },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={campaign ? `Edit ${campaign.name}` : "New campaign"} size="lg">
      <div className="flex flex-col gap-4">
        {errors.form && Object.keys(errors).length === 1 && <Notice>{errors.form}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" isRequired value={name} onChange={setName} isInvalid={Boolean(errors.name)} errorMessage={errors.name} />
          <TextField label="Code (optional)" value={code} onChange={setCode} isInvalid={Boolean(errors.code)} errorMessage={errors.code}
            description="Matched to utm_campaign in your ad and email links, such as diwali-2026." />
          <Select label="Usual medium" selectedKey={medium} onSelectionChange={(value) => setMedium(String(value ?? NONE))}
            options={[{ value: NONE, label: "Not set" }, ...CRM_MEDIUMS.map((entry) => ({ value: entry.code, label: entry.label }))]} />
          <TextField label="Budget (optional)" inputMode="decimal" value={budget} onChange={setBudget} isInvalid={Boolean(errors.budget)} errorMessage={errors.budget} />
          <TextField label="Starts on" type="date" value={startsOn} onChange={setStartsOn} isInvalid={Boolean(errors.startsOn)} errorMessage={errors.startsOn} />
          <TextField label="Ends on" type="date" value={endsOn} onChange={setEndsOn} isInvalid={Boolean(errors.endsOn)} errorMessage={errors.endsOn} />
        </div>
        <TextArea label="Description" value={description} onChange={setDescription} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>{campaign ? "Save" : "Create campaign"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
