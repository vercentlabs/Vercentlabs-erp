"use client";

// Data Quality: the review centre for duplicates. Detection itself happens
// wherever a record is created, imported or converted; this is where the
// pairs it found are reviewed, and where earlier decisions can be looked up:
// what was merged, and what was marked as not a duplicate.
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, EmptyState, PageHeader, PermissionState, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { duplicatesErrorMessage, listMergedRecords, listNotDuplicates, unmarkNotDuplicate, type NotDuplicatePair, type ReviewedRecord } from "../api/duplicates-api";
import { DuplicateReviewScreen } from "./DuplicateReviewScreen";

const RECORD_LABEL: Record<string, string> = { lead: "Lead", contact: "Contact", account: "Account" };

function RecordLink({ record }: { record: ReviewedRecord }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge tone="neutral">{RECORD_LABEL[record.type] ?? record.type}</Badge>
      <Link href={record.href} className="font-medium text-brand underline-offset-2 hover:underline">{record.name}</Link>
    </span>
  );
}

export function DataQualityScreen() {
  const workspace = useWorkspaceContext();
  const canReview = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(CRM_PERMISSIONS.duplicatesReview);
  if (!canReview) return <PermissionState title="You don't have access to Data Quality" description="Ask an administrator for the Review duplicates permission." />;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Data Quality" description="Review records that look like the same person or company, and see what was merged or cleared before." />
      <Tabs defaultSelectedKey="potential">
        <TabList aria-label="Data quality">
          <Tab id="potential">Potential Duplicates</Tab>
          <Tab id="merged">Merged Records</Tab>
          <Tab id="cleared">Not Duplicates</Tab>
        </TabList>
        <TabPanel id="potential"><div className="pt-3"><DuplicateReviewScreen embedded /></div></TabPanel>
        <TabPanel id="merged"><MergedRecords /></TabPanel>
        <TabPanel id="cleared"><NotDuplicates /></TabPanel>
      </Tabs>
    </div>
  );
}

function MergedRecords() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "merged-records"), queryFn: listMergedRecords });
  const rows = query.data ?? [];
  if (query.isLoading) return <LoadingState label="Loading merged records" rows={3} />;
  if (query.isError) return <p role="alert" className="pt-3 text-sm text-danger">{duplicatesErrorMessage(query.error, "The merged records could not be loaded.")}</p>;
  if (rows.length === 0) return <div className="pt-3"><EmptyState title="Nothing has been merged yet" description="When two records are merged, the one that was folded in is listed here with the record that was kept." /></div>;
  return (
    <ul className="mt-3 flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-1 px-4 py-3">
          <span className="flex flex-wrap items-center gap-2"><RecordLink record={row.merged} /><span className="text-text-secondary">was merged into</span><RecordLink record={row.kept} /></span>
          <span className="text-xs text-text-muted">{[row.mergedByName, row.mergedAt ? formatDateTime(row.mergedAt) : null].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

function NotDuplicates() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "not-duplicates");
  const query = useQuery({ queryKey: key, queryFn: listNotDuplicates });
  const restore = useMutation({
    mutationFn: (pair: NotDuplicatePair) => unmarkNotDuplicate(pair),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: key }); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "duplicate-queue") }); },
  });
  const rows = query.data ?? [];
  if (query.isLoading) return <LoadingState label="Loading decisions" rows={3} />;
  if (query.isError) return <p role="alert" className="pt-3 text-sm text-danger">{duplicatesErrorMessage(query.error, "The decisions could not be loaded.")}</p>;
  if (rows.length === 0) return <div className="pt-3"><EmptyState title="No pairs marked as not duplicates" description="A pair reviewed and kept separate is listed here, and is no longer reported." /></div>;
  return (
    <div className="flex flex-col gap-2 pt-3">
      {restore.isError && <p role="alert" className="text-sm text-danger">{duplicatesErrorMessage(restore.error)}</p>}
      <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2"><RecordLink record={row.a} /><span className="text-text-secondary">and</span><RecordLink record={row.b} /></span>
              <span className="text-xs text-text-muted">{[row.reason, row.decidedByName, formatDateTime(row.decidedAt)].filter(Boolean).join(" · ")}</span>
            </div>
            <Button variant="secondary" size="compact" isDisabled={restore.isPending} onPress={() => restore.mutate(row)}>Review again</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
