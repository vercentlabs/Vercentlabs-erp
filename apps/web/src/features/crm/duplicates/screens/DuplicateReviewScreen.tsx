"use client";

// Potential duplicates: pairs of existing records that look like the same
// person or company. They get here through imports, integrations and saves
// made with "Create anyway". Each pair is reviewed, merged, or marked as not
// a duplicate so it is not reported again. Needs the Review duplicates
// permission.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dialog, ErrorState, PageHeader, PermissionState, Tab, TabList, TabPanel, Tabs, TextArea } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  duplicatesErrorMessage, listDuplicateQueue, markNotDuplicate, type DuplicateQueuePair, type DuplicateQueueRecord, type DuplicateQueueType,
} from "../api/duplicates-api";
import { MatchReasons } from "../DuplicateParts";

const TABS: Array<{ type: DuplicateQueueType; label: string }> = [
  { type: "lead_lead", label: "Leads" },
  { type: "lead_contact", label: "Lead and contact" },
  { type: "contact_contact", label: "Contacts" },
  { type: "account_account", label: "Accounts" },
];
const RECORD_LABEL = { lead: "Lead", contact: "Contact", account: "Account" } as const;
const recordHref = (record: DuplicateQueueRecord) => `/crm/${record.type === "account" ? "accounts" : record.type === "contact" ? "contacts" : "leads"}/${record.id}`;

function RecordCard({ record }: { record: DuplicateQueueRecord }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--radius-control)] border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={record.type === "lead" ? "info" : "brand"}>{RECORD_LABEL[record.type]}</Badge>
        <Link href={recordHref(record)} target="_blank" className="font-medium text-brand underline-offset-2 hover:underline">{record.name || record.code || "Open record"}</Link>
      </div>
      <span className="text-text-secondary">{[record.code, record.detail, record.email].filter(Boolean).join(" · ")}</span>
      <span className="text-xs text-text-muted">{record.ownerName ? `Owner: ${record.ownerName} · ` : "Unassigned · "}Created {formatDate(record.createdAt)}</span>
    </div>
  );
}

export function DuplicateReviewScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canReview = workspace.roleSlugs?.includes("organization_owner") || workspace.permissions.includes(CRM_PERMISSIONS.duplicatesReview);
  const key = scopedQueryKey(workspace, "crm", "duplicate-queue");
  const query = useQuery({ queryKey: key, queryFn: () => listDuplicateQueue(), enabled: canReview });
  const [tab, setTab] = useState<DuplicateQueueType>("lead_lead");
  const [clearing, setClearing] = useState<DuplicateQueuePair | null>(null);

  if (!canReview) return <PermissionState title="You don't have access to duplicate review" description="Ask an administrator for the Review duplicates permission." />;

  const queue = query.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Potential duplicates"
        description="Records that share an email, a mobile number, a GSTIN, a website or a company name. Merge the ones that are the same, and mark the ones that are not so they stop appearing."
      />
      {query.isLoading ? <LoadingState label="Looking for duplicates" rows={5} />
        : query.isError || !queue ? <ErrorState title="Could not load the duplicate queue" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : (
          <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected) as DuplicateQueueType)}>
            <TabList aria-label="Duplicate types">
              {TABS.map((entry) => <Tab key={entry.type} id={entry.type}>{entry.label} ({queue.counts[entry.type] ?? 0})</Tab>)}
            </TabList>
            {TABS.map((entry) => {
              const pairs = queue.pairs.filter((pair) => pair.type === entry.type);
              return (
                <TabPanel key={entry.type} id={entry.type}>
                  {pairs.length === 0 ? (
                    <p className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-8 text-center text-sm text-text-secondary">No potential duplicates here.</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {pairs.map((pair) => (
                        <li key={`${pair.a.id}-${pair.b.id}`} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface-muted p-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <Badge tone={pair.matchStrength === "strong" ? "warning" : "neutral"}>{pair.matchStrength === "strong" ? "Strong match" : "Possible match"}</Badge>
                            <MatchReasons match={{ signals: pair.signals, strength: pair.matchStrength === "strong" ? "exact" : "possible", reasons: pair.reasons }} />
                          </div>
                          <div className="flex flex-col gap-2 md:flex-row">
                            <RecordCard record={pair.a} />
                            <RecordCard record={pair.b} />
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Link href={recordHref(pair.a)} className="font-medium text-brand underline-offset-2 hover:underline">
                              {pair.canMerge ? "Review and merge" : "Open the lead to convert or disqualify it"}
                            </Link>
                            <Button variant="secondary" size="compact" onPress={() => setClearing(pair)}>Not a duplicate</Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(queue.counts[entry.type] ?? 0) >= queue.limit && <p className="pt-3 text-sm text-text-secondary">Showing the newest {queue.limit}. Resolve these to see more.</p>}
                </TabPanel>
              );
            })}
          </Tabs>
        )}
      {clearing && <NotDuplicateDialog pair={clearing} onClose={() => setClearing(null)} onDone={() => void queryClient.invalidateQueries({ queryKey: key })} />}
    </div>
  );
}

function NotDuplicateDialog({ pair, onClose, onDone }: { pair: DuplicateQueuePair; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => markNotDuplicate(pair, reason),
    onSuccess: () => { onDone(); onClose(); },
    onError: (failure) => setError(duplicatesErrorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Mark as not a duplicate"
      description={`${pair.a.name ?? pair.a.code} and ${pair.b.name ?? pair.b.code} stay separate, and are no longer reported as a possible duplicate.`}>
      <div className="flex flex-col gap-4">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <TextArea label="Reason" description="Optional. For example: a company and its foundation share a website." value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>Not a duplicate</Button>
        </div>
      </div>
    </Dialog>
  );
}
