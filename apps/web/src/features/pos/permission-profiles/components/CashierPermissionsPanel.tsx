"use client";

// A cashier's Permissions tab: the assigned profile (and when and by whom), what it lets them do grouped by area with its limits (limits
// only for profile administrators), and — for those allowed — assigning another active profile. Profiles are edited on their own page,
// never per cashier.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge } from "@vercentlabs/design-system";

import { ErrorBanner, NONE, orNull, withNone } from "@/features/items/item-format";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { PROFILES_BASE, assignProfile, errorMessage, getCashierPermissions, limitText, listProfiles, statusLabel } from "../api/profiles-api";

const AREA_LABEL: Record<string, string> = {
  sessions: "POS access and sessions", sales: "Sales and checkout", discounts: "Discounts and prices", receipts: "Receipts and lookup", returns: "Returns and refunds",
  cash: "Cash drawer and movements", approvals: "Supervisor approvals",
};

export function CashierPermissionsPanel({ cashierId, onChanged }: { cashierId: string; onChanged?: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const assignAllowed = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("pos.permission_profiles.assign");
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "pos-cashiers", "permissions", cashierId), queryFn: () => getCashierPermissions(cashierId) });
  const profiles = useQuery({ queryKey: scopedQueryKey(workspace, "pos-profiles", "list", { status: "active" }), queryFn: () => listProfiles({ status: "active" }), enabled: assignAllowed });
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (profileId: string | null) => assignProfile(cashierId, profileId),
    onSuccess: (result) => {
      setError(null); setChoice(null); setNotice(result?.profileName ? `Now holds ${result.profileName}.` : "Profile removed: this cashier cannot operate POS until one is assigned.");
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-cashiers") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-profiles") });
      onChanged?.();
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  if (summary.isLoading) return <LoadingState label="Loading permissions" rows={4} />;
  if (summary.isError) return <ErrorBanner message={errorMessage(summary.error)} />;
  const data = summary.data;
  const selected = choice ?? data?.profileId ?? NONE;
  const granted = (data?.grants ?? []).filter((grant) => grant.enabled);
  const areas = [...new Set(granted.map((grant) => grant.area))];
  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={error} />
      {notice && <Notice tone="success">{notice}</Notice>}
      <Panel title="Permission profile" description="What this cashier may do at a POS and within which limits. One profile applies at every outlet they work at."
        actions={data?.profileId ? <Link className="text-sm font-medium text-brand hover:underline" href={`${PROFILES_BASE}/${data.profileId}`}>Open profile</Link> : undefined}>
        <FactList columns={2} items={[
          ["Profile", data?.profileName ? `${data.profileName} (${data.profileCode})` : "None — cannot operate POS"],
          ["Status", data?.profileStatus ? statusLabel(data.profileStatus) : null],
          ["Assigned", data?.assignedAt ? `${formatDateTime(data.assignedAt)}${data.assignedBy ? ` by ${data.assignedBy}` : ""}` : null],
        ]} />
        {assignAllowed && (
          <div className="flex flex-wrap items-end gap-2">
            <Select label="Assign a profile" className="w-72" selectedKey={selected} onSelectionChange={(key) => setChoice(String(key))}
              options={withNone((profiles.data?.profiles ?? []).map((profile) => ({ value: profile.id, label: `${profile.name} (${profile.code})` })), "No profile")} />
            <Button variant="secondary" isDisabled={selected === (data?.profileId ?? NONE)} isLoading={save.isPending} onPress={() => save.mutate(orNull(selected))}>Assign</Button>
          </div>
        )}
      </Panel>
      {areas.length === 0 ? <p className="text-sm text-text-muted">Nothing granted.</p> : areas.map((area) => (
        <Panel key={area} title={AREA_LABEL[area] ?? area}>
          <LinesTable columns={["Permission", "Limit", "Reason"]}>
            {granted.filter((grant) => grant.area === area).map((grant) => (
              <tr key={grant.code}>
                <Cell><span className="font-medium">{grant.label}</span></Cell>
                <Cell>{grant.limits.length ? limitText(grant) : <StatusBadge tone="success">Granted</StatusBadge>}</Cell>
                <Cell>{grant.requireReason ? "Required" : null}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      ))}
    </div>
  );
}
