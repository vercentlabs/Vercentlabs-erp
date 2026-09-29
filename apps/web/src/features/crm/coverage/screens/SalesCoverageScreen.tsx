"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Dialog,
  ErrorState,
  PageHeader,
  PermissionState,
  Select,
  StatusBadge,
  TextArea,
  TextField,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDate, formatMoney, humanize } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import {
  CoverageApiError,
  getSalesCoverage,
  listUnassigned,
  reassignCoverage,
  transferTerritory,
  type CoverageTeam,
  type CoverageTerritory,
  type ReassignmentResult,
  type UnassignedRecord,
  type UnassignedType,
} from "../api/coverage-api";

const TYPES: Array<{ id: UnassignedType; label: string }> = [
  { id: "leads", label: "Leads" },
  { id: "opportunities", label: "Opportunities" },
  { id: "accounts", label: "Accounts" },
];

const RECORD_HREF: Record<UnassignedType, string> = {
  leads: "/crm/leads",
  opportunities: "/crm/opportunities",
  accounts: "/crm/accounts",
};

function childrenOf<T extends { id: string }>(
  rows: T[],
  parentKey: keyof T,
  parent: string | null,
): T[] {
  return rows.filter((row) => (row[parentKey] ?? null) === parent);
}

// F020 Sales coverage: who covers what by team and territory hierarchy,
// where coverage is missing, and governed reassignment of unowned work.
// Structure is edited in Setup; this is the operator workspace.
export function SalesCoverageScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const coverageKey = scopedQueryKey(workspace, "crm", "coverage");
  const coverage = useQuery({
    queryKey: coverageKey,
    queryFn: getSalesCoverage,
  });
  const options = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "options"),
    queryFn: () => getCrmOptions(),
  });
  const [type, setType] = useState<UnassignedType>("leads");
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [transferTarget, setTransferTarget] =
    useState<CoverageTerritory | null>(null);
  const [lastResult, setLastResult] = useState<ReassignmentResult | null>(null);

  const unassigned = useInfiniteQuery({
    queryKey: [...coverageKey, "unassigned", type],
    queryFn: ({ pageParam }) => listUnassigned(type, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: coverage.isSuccess,
  });

  const users = useMemo(
    () =>
      (options.data?.options.users ?? []).map((user) => ({
        value: String(user.id),
        label: String(user.fullName ?? user.name ?? user.email ?? user.id),
      })),
    [options.data],
  );
  const teamsOptions = useMemo(
    () =>
      (options.data?.options.salesTeams ?? []).map((team) => ({
        value: String(team.id),
        label: String(team.name),
      })),
    [options.data],
  );

  if (coverage.isLoading)
    return (
      <LoadingState
        label="Loading sales coverage"
        rows={5}
        onRetry={() => coverage.refetch()}
      />
    );
  if (coverage.isError) {
    if (
      coverage.error instanceof CoverageApiError &&
      coverage.error.status === 403
    )
      return (
        <PermissionState
          title="You don't have access to sales coverage"
          description="Ask an administrator for coverage access."
        />
      );
    return (
      <ErrorState
        title="Could not load sales coverage"
        action={{ label: "Retry", onPress: () => coverage.refetch() }}
      />
    );
  }
  const data = coverage.data!;
  const records = unassigned.data?.pages.flatMap((page) => page.records) ?? [];
  const canEditStructure =
    data.permissions.manageTeams || data.permissions.manageTerritories;

  function toggle(record: UnassignedRecord, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(record.id, record.updatedAt);
      else next.delete(record.id);
      return next;
    });
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: coverageKey });
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Sales coverage"
        description={`Who covers what, where coverage is missing, and work nobody owns. As of ${formatDate(data.asOf)}.`}
        secondaryActions={
          canEditStructure ? (
            <Link
              href="/crm/settings/territories"
              className="text-sm font-medium text-brand hover:underline"
            >
              Edit teams and territories
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label="Unassigned leads" value={data.unassigned.leads} />
        <Figure
          label="Unassigned opportunities"
          value={data.unassigned.opportunities}
        />
        <Figure label="Unassigned accounts" value={data.unassigned.accounts} />
        <Figure label="Coverage gaps" value={data.gaps.length} />
      </div>

      <section
        aria-label="Coverage gaps"
        className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4"
      >
        <h2 className="text-sm font-semibold text-text">Coverage gaps</h2>
        {data.gaps.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Every active territory has an owner and every team has a manager and
            members.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.gaps.map((gap) => (
              <li
                key={`${gap.kind}:${gap.id}`}
                className="flex flex-wrap items-baseline gap-2 text-sm"
              >
                <StatusBadge tone="warning">{humanize(gap.kind)}</StatusBadge>
                <span className="font-medium text-text">{gap.label}</span>
                <span className="text-text-muted">{gap.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section
          aria-label="Sales teams"
          className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
        >
          <h2 className="text-sm font-semibold text-text">Sales teams</h2>
          {data.teams.length === 0 ? (
            <p className="text-sm text-text-secondary">No sales teams yet.</p>
          ) : (
            <TeamTree
              teams={data.teams}
              parent={null}
              depth={0}
              currency={null}
            />
          )}
          {(data.unattributedWork.openOpportunities > 0 ||
            data.unattributedWork.openLeads > 0) && (
            <p className="text-xs text-text-muted">
              {`Not in any team: ${data.unattributedWork.openLeads} open leads, ${data.unattributedWork.openOpportunities} open opportunities.`}
            </p>
          )}
        </section>

        <section
          aria-label="Territories"
          className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
        >
          <h2 className="text-sm font-semibold text-text">Territories</h2>
          {data.territories.length === 0 ? (
            <p className="text-sm text-text-secondary">No territories yet.</p>
          ) : (
            <TerritoryTree
              territories={data.territories}
              parent={null}
              depth={0}
              onTransfer={
                data.permissions.manageTerritories || data.permissions.reassign
                  ? setTransferTarget
                  : undefined
              }
            />
          )}
        </section>
      </div>

      <section
        aria-label="Unassigned work"
        className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-text">Unassigned work</h2>
            <ViewToggle
              label="Record type"
              options={TYPES}
              value={type}
              onChange={(id) => {
                setType(id as UnassignedType);
                setSelected(new Map());
              }}
            />
          </div>
          {data.permissions.reassign && (
            <Button
              variant="primary"
              isDisabled={selected.size === 0}
              onPress={() => setReassignOpen(true)}
            >
              {`Reassign ${selected.size || ""} selected`.replace("  ", " ")}
            </Button>
          )}
        </div>
        {lastResult && (
          <p className="text-sm text-text" role="status">
            {`${lastResult.summary.applied} reassigned`}
            {lastResult.summary.conflict
              ? `, ${lastResult.summary.conflict} changed by someone else (refresh and retry)`
              : ""}
            {lastResult.summary.skipped
              ? `, ${lastResult.summary.skipped} skipped`
              : ""}
            {lastResult.summary.failed
              ? `, ${lastResult.summary.failed} failed`
              : ""}
            .
          </p>
        )}
        {unassigned.isLoading ? (
          <LoadingState label="Loading unassigned records" rows={3} />
        ) : records.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {`No unassigned ${type}.`}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {records.map((record) => (
              <li
                key={record.id}
                className="flex items-center gap-3 py-2 text-sm"
              >
                {data.permissions.reassign && (
                  <Checkbox
                    aria-label={`Select ${record.name ?? record.code ?? "record"}`}
                    isSelected={selected.has(record.id)}
                    onChange={(checked) => toggle(record, checked)}
                  />
                )}
                <Link
                  href={`${RECORD_HREF[type]}/${record.id}`}
                  className="font-medium text-text hover:underline"
                >
                  {record.name || record.code || "Untitled"}
                </Link>
                <span className="text-text-muted">
                  {[record.detail, record.city, record.countryCode]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="ml-auto text-xs text-text-muted">
                  {`Created ${formatDate(record.createdAt)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {unassigned.hasNextPage && (
          <div>
            <Button
              variant="secondary"
              onPress={() => unassigned.fetchNextPage()}
              isLoading={unassigned.isFetchingNextPage}
            >
              Load more
            </Button>
          </div>
        )}
      </section>

      <ReassignDialog
        isOpen={reassignOpen}
        onOpenChange={setReassignOpen}
        type={type}
        selected={selected}
        users={users}
        onDone={(result) => {
          setLastResult(result);
          setSelected(new Map());
          setReassignOpen(false);
          refresh();
        }}
      />
      <TransferDialog
        territory={transferTarget}
        users={users}
        teams={teamsOptions}
        onClose={() => setTransferTarget(null)}
        onDone={() => {
          setTransferTarget(null);
          refresh();
        }}
      />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-text">
        {value.toLocaleString("en-IN")}
      </span>
    </div>
  );
}

function TeamTree({
  teams,
  parent,
  depth,
  currency,
}: {
  teams: CoverageTeam[];
  parent: string | null;
  depth: number;
  currency: string | null;
}) {
  const level = childrenOf(teams, "parentTeamId", parent);
  if (!level.length || depth > 20) return null;
  return (
    <ul className={depth ? "ml-4 border-l border-border pl-3" : ""}>
      {level.map((team) => (
        <li key={team.id} className="flex flex-col gap-1 py-1.5">
          <div className="flex flex-wrap items-baseline gap-2 text-sm">
            <span className="font-medium text-text">{team.name}</span>
            {team.status !== "active" && (
              <StatusBadge tone="neutral">{humanize(team.status)}</StatusBadge>
            )}
            <span className="text-text-muted">
              {team.managerName
                ? `Managed by ${team.managerName}`
                : "No manager"}
            </span>
            <span className="ml-auto text-xs tabular-nums text-text-secondary">
              {`${team.work.openLeads} leads · ${team.work.openOpportunities} deals · ${formatMoney(currency, team.work.openPipeline, { compact: true })}`}
            </span>
          </div>
          {team.members.length > 0 && (
            <details className="text-xs text-text-secondary">
              <summary className="cursor-pointer">
                {`${team.currentMemberCount} current member${team.currentMemberCount === 1 ? "" : "s"}`}
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {team.members.map((member) => (
                  <li
                    key={`${member.userId}-${member.effectiveFrom}`}
                    className="flex flex-wrap gap-2"
                  >
                    <span className="text-text">{member.name}</span>
                    <span>{humanize(member.role)}</span>
                    <span>
                      {`${formatDate(member.effectiveFrom)} – ${member.effectiveTo ? formatDate(member.effectiveTo) : "open"}`}
                    </span>
                    {member.state !== "current" && (
                      <StatusBadge
                        tone={member.state === "ended" ? "neutral" : "info"}
                      >
                        {humanize(member.state)}
                      </StatusBadge>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <TeamTree
            teams={teams}
            parent={team.id}
            depth={depth + 1}
            currency={currency}
          />
        </li>
      ))}
    </ul>
  );
}

function TerritoryTree({
  territories,
  parent,
  depth,
  onTransfer,
}: {
  territories: CoverageTerritory[];
  parent: string | null;
  depth: number;
  onTransfer?: (territory: CoverageTerritory) => void;
}) {
  const level = childrenOf(territories, "parentTerritoryId", parent);
  if (!level.length || depth > 20) return null;
  return (
    <ul className={depth ? "ml-4 border-l border-border pl-3" : ""}>
      {level.map((territory) => (
        <li key={territory.id} className="flex flex-col gap-1 py-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-text">{territory.name}</span>
            <span className="text-xs text-text-muted">
              {humanize(territory.territoryType)}
            </span>
            {territory.primaryAssigneeName ? (
              <span className="text-text-secondary">
                {`${territory.primaryAssigneeType === "team" ? "Team" : "Owner"}: ${territory.primaryAssigneeName}`}
              </span>
            ) : territory.status === "active" ? (
              <StatusBadge tone="warning">No owner</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">
                {humanize(territory.status)}
              </StatusBadge>
            )}
            {territory.secondaryAssignments > 0 && (
              <span className="text-xs text-text-muted">{`+${territory.secondaryAssignments} overlay`}</span>
            )}
            {onTransfer && territory.status === "active" && (
              <Button
                variant="ghost"
                size="compact"
                className="ml-auto"
                onPress={() => onTransfer(territory)}
                aria-label={`Change owner of ${territory.name}`}
              >
                Change owner
              </Button>
            )}
          </div>
          <TerritoryTree
            territories={territories}
            parent={territory.id}
            depth={depth + 1}
            onTransfer={onTransfer}
          />
        </li>
      ))}
    </ul>
  );
}

function ReassignDialog({
  isOpen,
  onOpenChange,
  type,
  selected,
  users,
  onDone,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  type: UnassignedType;
  selected: Map<string, string>;
  users: Array<{ value: string; label: string }>;
  onDone: (result: ReassignmentResult) => void;
}) {
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      reassignCoverage({
        type,
        ids: [...selected.keys()],
        ownerUserId: owner,
        reason,
        expectedUpdatedAt: Object.fromEntries(selected),
      }),
    onSuccess: (result) => {
      setReason("");
      onDone(result);
    },
  });
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Reassign ${selected.size} ${type}`}
      description="Each record moves through its own assignment rules; a record changed since you loaded it is not overwritten."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Select
          label="New owner"
          isRequired
          options={[{ value: "", label: "Choose an owner" }, ...users]}
          selectedKey={owner}
          onSelectionChange={(key) => setOwner(String(key ?? ""))}
        />
        <TextArea
          label="Reason"
          isRequired
          value={reason}
          onChange={setReason}
          description="Kept in the audit history (3–500 characters)."
        />
        {mutation.isError && (
          <p role="alert" className="text-sm text-danger">
            {(mutation.error as Error).message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isDisabled={!owner || reason.trim().length < 3}
            isLoading={mutation.isPending}
          >
            Reassign
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TransferDialog({
  territory,
  users,
  teams,
  onClose,
  onDone,
}: {
  territory: CoverageTerritory | null;
  users: Array<{ value: string; label: string }>;
  teams: Array<{ value: string; label: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [assigneeType, setAssigneeType] = useState<"user" | "team">("user");
  const [assigneeId, setAssigneeId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      transferTerritory(territory!.id, {
        assigneeType,
        assigneeId,
        effectiveFrom,
        reason,
      }),
    onSuccess: () => {
      setAssigneeId("");
      setReason("");
      onDone();
    },
  });
  return (
    <Dialog
      isOpen={territory !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={territory ? `Change owner of ${territory.name}` : "Change owner"}
      description="The current owner's coverage ends the day before the new owner's starts, so history stays complete."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Select
          label="New owner is a"
          options={[
            { value: "user", label: "Person" },
            { value: "team", label: "Sales team" },
          ]}
          selectedKey={assigneeType}
          onSelectionChange={(key) => {
            setAssigneeType(key === "team" ? "team" : "user");
            setAssigneeId("");
          }}
        />
        <Select
          label={assigneeType === "team" ? "Sales team" : "Person"}
          isRequired
          options={[
            { value: "", label: "Choose" },
            ...(assigneeType === "team" ? teams : users),
          ]}
          selectedKey={assigneeId}
          onSelectionChange={(key) => setAssigneeId(String(key ?? ""))}
        />
        <TextField
          label="Starting"
          type="date"
          value={effectiveFrom}
          onChange={setEffectiveFrom}
          isRequired
        />
        <TextArea
          label="Reason"
          isRequired
          value={reason}
          onChange={setReason}
        />
        {mutation.isError && (
          <p role="alert" className="text-sm text-danger">
            {(mutation.error as Error).message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isDisabled={!assigneeId || reason.trim().length < 3}
            isLoading={mutation.isPending}
          >
            Change owner
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
