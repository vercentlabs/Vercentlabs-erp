"use client";

// One permission profile: Overview, Permissions (grouped by area), Limits, Assigned Cashiers and History. Activation validates the profile;
// deactivation waits until no active cashier holds it; a profile once activated or assigned is never deleted.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Button, EmptyState, ErrorState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";

import { ErrorBanner } from "@/features/items/item-format";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  PROFILES_BASE, STATUS_TONE, cloneProfile, deleteProfile, errorCode, errorMessage, getProfile, getProfileHistory, issuesOf, limitText, setProfileStatus, statusLabel, type Profile,
} from "../api/profiles-api";

const TABS = ["overview", "permissions", "limits", "cashiers", "history"] as const;

export function ProfileDetailScreen({ profileId, initialTab }: { profileId: string; initialTab?: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>(() => (initialTab && (TABS as readonly string[]).includes(initialTab) ? initialTab : "overview"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Array<{ code: string; message: string }>>([]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-profiles", "one", profileId), queryFn: () => getProfile(profileId) });
  const refresh = (message?: string) => { setError(null); setProblems([]); if (message) setNotice(message); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-profiles") }); };
  const fail = (failure: unknown) => { setProblems(issuesOf(failure)); setError(errorMessage(failure)); };
  const status = useMutation({ mutationFn: (next: "active" | "inactive") => setProfileStatus(profileId, next), onSuccess: (saved) => refresh(saved.status === "active" ? "Activated. It can now be assigned to cashiers." : "Deactivated."), onError: fail });
  const clone = useMutation({ mutationFn: () => cloneProfile(profileId), onSuccess: (copy) => { refresh(); router.push(`${PROFILES_BASE}/${copy.id}/edit`); }, onError: fail });
  const remove = useMutation({ mutationFn: () => deleteProfile(profileId), onSuccess: () => { refresh(); router.push(PROFILES_BASE); }, onError: (failure) => { setConfirmDelete(false); fail(failure); } });

  if (query.isLoading) return <LoadingState label="Loading profile" rows={6} />;
  if (query.isError) return errorCode(query.error) === "POS_PERMISSION_PROFILE_NOT_FOUND"
    ? <EmptyState title="Profile not found" description="It may have been deleted." action={{ label: "All profiles", onPress: () => router.push(PROFILES_BASE) }} />
    : <ErrorState title="Could not load the profile" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const profile = query.data!;
  const can = profile.capabilities;
  const menu = [
    { id: "clone", label: "Clone", run: () => clone.mutate(), show: can.manage },
    { id: "deactivate", label: "Deactivate", run: () => status.mutate("inactive"), show: can.status && profile.status === "active" },
    { id: "delete", label: "Delete", run: () => setConfirmDelete(true), show: can.manage && profile.status === "draft" && profile.assignedCashiers === 0 },
  ];

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{profile.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{profile.code}</span></>,
          status: <StatusBadge tone={STATUS_TONE[profile.status]}>{statusLabel(profile.status)}</StatusBadge>,
          fields: [
            { label: "Assigned cashiers", value: String(profile.assignedCashiers) },
            { label: "Permissions granted", value: String(profile.enabledGrants) },
            { label: "Updated", value: `${formatDateTime(profile.updatedAt)}${profile.updatedBy ? ` · ${profile.updatedBy}` : ""}` },
          ],
          primaryAction: can.status && profile.status !== "active"
            ? <Button variant="primary" isLoading={status.isPending} onPress={() => { setNotice(null); status.mutate("active"); }}>Activate</Button> : undefined,
          secondaryActions: (
            <>
              {can.manage && <Button variant="secondary" onPress={() => router.push(`${PROFILES_BASE}/${profile.id}/edit`)}>Edit</Button>}
              <MoreActions actions={menu.map((entry) => ({ ...entry, run: () => { setError(null); setNotice(null); entry.run(); } }))} />
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            {notice && <Notice tone="success">{notice}</Notice>}
            {(problems.length ? problems : profile.status !== "active" ? profile.issues : []).length > 0 && (
              <Notice tone={problems.length ? "danger" : "warning"}>
                <span className="font-medium">{problems.length ? "This profile cannot be activated yet." : "Before activating:"}</span>
                <ul className="mt-1 list-disc pl-5">{(problems.length ? problems : profile.issues).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>
              </Notice>
            )}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Profile sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="permissions">Permissions</Tab>
            <Tab id="limits">Limits</Tab>
            <Tab id="cashiers">Assigned Cashiers</Tab>
            {can.viewHistory && <Tab id="history">History</Tab>}
          </TabList>
          <TabPanel id="overview" className="pt-3">
            <FactList items={[["Name", profile.name], ["Code", profile.code], ["Status", statusLabel(profile.status)], ["Description", profile.description],
              ["Assigned cashiers", `${profile.assignedCashiers} (${profile.activeCashiers} active)`], ["Currency for amount limits", profile.currency]]} />
          </TabPanel>
          <TabPanel id="permissions" className="flex flex-col gap-4 pt-3"><PermissionsPanel profile={profile} /></TabPanel>
          <TabPanel id="limits" className="pt-3"><LimitsPanel profile={profile} /></TabPanel>
          <TabPanel id="cashiers" className="pt-3">
            <Panel title="Assigned cashiers" description="Assign profiles on each cashier's Permissions tab. Deactivating this profile needs its active cashiers reassigned first.">
              <LinesTable columns={["Cashier", "Status", "Assigned", "By"]} empty={profile.cashiers.length ? undefined : "No cashier holds this profile."}>
                {profile.cashiers.map((cashier) => (
                  <tr key={cashier.id}>
                    <Cell><Link className="font-medium text-brand hover:underline" href={`/pos/cashiers/${cashier.id}?tab=permissions`}>{cashier.code} · {cashier.name}</Link></Cell>
                    <Cell><StatusBadge tone={cashier.status === "active" ? "success" : "neutral"}>{statusLabel(cashier.status)}</StatusBadge></Cell>
                    <Cell>{cashier.assignedAt ? formatDateTime(cashier.assignedAt) : null}</Cell>
                    <Cell>{cashier.assignedBy}</Cell>
                  </tr>
                ))}
              </LinesTable>
            </Panel>
          </TabPanel>
          <TabPanel id="history" className="pt-3"><HistoryPanel profile={profile} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>
      <AlertDialog isOpen={confirmDelete} onOpenChange={(isOpen) => !isOpen && setConfirmDelete(false)} title={`Delete ${profile.name}?`}
        description="Only a Draft that was never activated or assigned can be deleted." confirmLabel="Delete" isConfirming={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

function PermissionsPanel({ profile }: { profile: Profile }) {
  return (
    <>
      {profile.areas.map((area) => {
        const grants = profile.grants.filter((grant) => grant.area === area.code);
        return (
          <Panel key={area.code} title={area.label}>
            <LinesTable columns={["Permission", "Granted", "Reason"]}>
              {grants.map((grant) => (
                <tr key={grant.code}>
                  <Cell><span className="flex flex-col"><span className="font-medium">{grant.label}</span><span className="text-xs text-text-muted">{grant.description}</span></span></Cell>
                  <Cell><StatusBadge tone={grant.enabled ? "success" : "neutral"}>{grant.enabled ? "Granted" : "Not granted"}</StatusBadge></Cell>
                  <Cell>{grant.enabled && grant.requireReason ? "Required" : null}</Cell>
                </tr>
              ))}
            </LinesTable>
          </Panel>
        );
      })}
    </>
  );
}

function LimitsPanel({ profile }: { profile: Profile }) {
  const limited = profile.grants.filter((grant) => grant.limits.length);
  return (
    <Panel title="Limits" description="Both a percentage and an amount must hold when an action has both. Above a limit, an action needs a supervisor's approval where the catalogue allows one.">
      <LinesTable columns={["Action", "Limit", "Exception approved by"]}>
        {limited.map((grant) => (
          <tr key={grant.code}>
            <Cell><span className="font-medium">{grant.label}</span></Cell>
            <Cell>{limitText(grant)}</Cell>
            <Cell>{grant.approvalCode ? profile.grants.find((other) => other.code === grant.approvalCode)?.label ?? grant.approvalCode : null}</Cell>
          </tr>
        ))}
      </LinesTable>
    </Panel>
  );
}

function HistoryPanel({ profile }: { profile: Profile }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-profiles", "history", profile.id), queryFn: () => getProfileHistory(profile.id), enabled: profile.capabilities.viewHistory });
  if (query.isLoading) return <LoadingState label="Loading history" rows={3} />;
  if (query.isError) return <ErrorBanner message={errorMessage(query.error)} />;
  return <HistoryList title={null} empty="No changes recorded yet." entries={(query.data ?? []).map((row) => ({ summary: row.summary, at: row.createdAt, actor: row.actorName }))} />;
}
