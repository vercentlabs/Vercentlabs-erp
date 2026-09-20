"use client";

// F306 — Loyalty program administration + a real-ledger customer balance
// lookup. The ledger view shows REAL ledger entries (never a single balance
// number with no history), per this feature's own non-negotiable.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, MetricStrip, NumberField, PageHeader, StatusBadge, TextField } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";
import type { PosLoyaltyProgram } from "@vercentlabs/api";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import type { PosCustomerMatch } from "@/features/pos/checkout/api/checkout-api";
import {
  adjustPosCustomerLoyaltyBalance,
  expirePosLoyaltyPoints,
  getPosCustomerLoyaltyBalance,
  getPosLoyaltyProgram,
  listPosCustomerLoyaltyLedger,
  setPosLoyaltyProgramActive,
  upsertPosLoyaltyProgram,
} from "@/features/pos/loyalty/api/loyalty-api";
import { dateTime, statusLabel, statusTone } from "@/features/pos/shared/format";
import { PosCustomerPicker } from "@/features/pos/shared/PosCustomerPicker";
import { PosAlert, PosDataTable, PosFacts, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";

export function PosLoyaltyScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.loyaltyManage);

  const programQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "loyalty", "program"), queryFn: getPosLoyaltyProgram });
  const program = programQuery.data?.record ?? null;

  const toggleActiveMutation = useMutation({
    mutationFn: (active: boolean) => setPosLoyaltyProgramActive(active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "loyalty", "program") }),
  });

  const [expiryNotice, setExpiryNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const expireMutation = useMutation({
    mutationFn: expirePosLoyaltyPoints,
    onSuccess: ({ result }) => {
      setExpiryNotice({
        tone: "success",
        text:
          result.customersExpired > 0
            ? `${result.pointsExpired} points expired across ${result.customersExpired} customer${result.customersExpired === 1 ? "" : "s"}.${result.moreRemaining ? " More remain — run it again." : ""}`
            : "Nothing to expire — no points have outlived the expiry window.",
      });
      // Balances and ledgers changed underneath any open lookup.
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "loyalty") });
    },
    onError: (err) => setExpiryNotice({ tone: "danger", text: err instanceof PosApiError ? err.message : "The expiry run could not be completed." }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Loyalty"
        description="Configure the loyalty program and look up a customer's real points balance and ledger history."
        primaryAction={
          canManage && program?.points_expiry_days ? (
            <Button variant="secondary" onPress={() => expireMutation.mutate()} isLoading={expireMutation.isPending}>
              Run points expiry
            </Button>
          ) : undefined
        }
      />
      {expiryNotice && <PosAlert tone={expiryNotice.tone}>{expiryNotice.text}</PosAlert>}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <PosPanel
          title="Program"
          description="How customers earn and redeem points at every POS store."
          actions={
            program ? (
              <div className="flex items-center gap-2">
                <StatusBadge tone={statusTone(program.status)}>{statusLabel(program.status)}</StatusBadge>
                {canManage && (
                  <Button variant="secondary" size="compact" onPress={() => toggleActiveMutation.mutate(program.status !== "active")} isLoading={toggleActiveMutation.isPending}>
                    {program.status === "active" ? "Deactivate" : "Activate"}
                  </Button>
                )}
              </div>
            ) : undefined
          }
        >
          {programQuery.isLoading ? (
            <PosLoading />
          ) : programQuery.isError ? (
            <ErrorState title="Could not load the loyalty program" action={{ label: "Retry", onPress: () => programQuery.refetch() }} />
          ) : canManage ? (
            // Keyed by the saved row so the form re-initializes from what is
            // actually stored (never from placeholder defaults) each time the
            // program changes underneath it.
            <ProgramForm key={`${program?.id ?? "new"}:${String(program?.updated_at ?? "")}`} program={program} />
          ) : program ? (
            <ProgramFacts program={program} />
          ) : (
            <p className="text-sm text-text-secondary">No loyalty program is configured yet.</p>
          )}
        </PosPanel>

        <CustomerLookup canManage={canManage} />
      </div>
    </div>
  );
}

function ProgramFacts({ program }: { program: PosLoyaltyProgram }) {
  return (
    <PosFacts
      columns={2}
      items={[
        { label: "Program", value: program.name },
        { label: "Earn rate", value: `${program.earn_rate_points_per_currency} pts / currency unit` },
        { label: "Redemption value", value: `${program.redemption_value_per_point} / pt` },
        { label: "Minimum to redeem", value: `${program.min_redemption_points} pts` },
        { label: "Max per sale", value: program.max_redemption_points_per_sale ? `${program.max_redemption_points_per_sale} pts` : "No limit" },
        { label: "Max % of payable", value: program.max_redemption_percent_of_payable ? `${program.max_redemption_percent_of_payable}%` : "No limit" },
        { label: "Minimum sale to earn", value: program.min_eligible_sale_amount },
        { label: "Points expiry", value: program.points_expiry_days ? `${program.points_expiry_days} days` : "Never" },
      ]}
    />
  );
}

function ProgramForm({ program }: { program: PosLoyaltyProgram | null }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();

  // Initialised from the stored program; the defaults below apply only when
  // no program exists yet (first-time setup).
  const [name, setName] = useState(program?.name ?? "");
  const [earnRate, setEarnRate] = useState(Number(program?.earn_rate_points_per_currency ?? 0.1));
  const [redemptionValue, setRedemptionValue] = useState(Number(program?.redemption_value_per_point ?? 0.5));
  const [minRedemption, setMinRedemption] = useState(Number(program?.min_redemption_points ?? 0));
  const [maxRedemptionPerSale, setMaxRedemptionPerSale] = useState(Number(program?.max_redemption_points_per_sale ?? 0));
  const [maxPercentOfPayable, setMaxPercentOfPayable] = useState(Number(program?.max_redemption_percent_of_payable ?? 0));
  const [minEligibleAmount, setMinEligibleAmount] = useState(Number(program?.min_eligible_sale_amount ?? 0));
  const [expiryDays, setExpiryDays] = useState(Number(program?.points_expiry_days ?? 0));
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertPosLoyaltyProgram({
        name: name.trim(),
        earnRatePointsPerCurrency: earnRate,
        redemptionValuePerPoint: redemptionValue,
        minRedemptionPoints: minRedemption,
        maxRedemptionPointsPerSale: maxRedemptionPerSale > 0 ? maxRedemptionPerSale : null,
        maxRedemptionPercentOfPayable: maxPercentOfPayable > 0 ? maxPercentOfPayable : null,
        minEligibleSaleAmount: minEligibleAmount,
        pointsExpiryDays: expiryDays > 0 ? Math.round(expiryDays) : null,
      }),
    onSuccess: () => {
      setFormError(null);
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "loyalty", "program") });
    },
    onError: (err) => {
      setSaved(false);
      setFormError(err instanceof PosApiError ? err.message : "The program could not be saved.");
    },
  });

  function edit<T>(setter: (value: T) => void) {
    return (value: T) => {
      setSaved(false);
      setter(value);
    };
  }

  return (
    <div className="flex flex-col gap-4">
      {formError && <PosAlert>{formError}</PosAlert>}
      {saved && <PosAlert tone="success">Program saved.</PosAlert>}
      <TextField label="Program name" isRequired value={name} onChange={edit(setName)} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberField label="Earn rate (points per currency unit)" value={earnRate} onChange={edit(setEarnRate)} minValue={0} step={0.01} />
        <NumberField label="Redemption value (currency per point)" value={redemptionValue} onChange={edit(setRedemptionValue)} minValue={0} step={0.01} />
        <NumberField label="Minimum points to redeem" value={minRedemption} onChange={edit(setMinRedemption)} minValue={0} />
        <NumberField label="Max points per sale (0 = no limit)" value={maxRedemptionPerSale} onChange={edit(setMaxRedemptionPerSale)} minValue={0} />
        <NumberField label="Max redemption % of payable (0 = no limit)" value={maxPercentOfPayable} onChange={edit(setMaxPercentOfPayable)} minValue={0} maxValue={100} />
        <NumberField label="Minimum eligible sale amount to earn" value={minEligibleAmount} onChange={edit(setMinEligibleAmount)} minValue={0} step={0.01} />
        <NumberField label="Points expire after (days, 0 = never)" value={expiryDays} onChange={edit(setExpiryDays)} minValue={0} step={1} />
      </div>
      <div>
        <Button variant="primary" onPress={() => saveMutation.mutate()} isLoading={saveMutation.isPending} isDisabled={!name.trim() || earnRate <= 0 || redemptionValue <= 0}>
          Save program
        </Button>
      </div>
    </div>
  );
}

function CustomerLookup({ canManage }: { canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<PosCustomerMatch | null>(null);
  const [adjustPoints, setAdjustPoints] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const customerId = customer?.id ?? "";
  const balanceQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "loyalty", "balance", customerId),
    queryFn: () => getPosCustomerLoyaltyBalance(customerId),
    enabled: Boolean(customerId),
  });
  const ledgerQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "loyalty", "ledger", customerId),
    queryFn: () => listPosCustomerLoyaltyLedger(customerId, 50),
    enabled: Boolean(customerId),
  });

  const adjustMutation = useMutation({
    mutationFn: () => adjustPosCustomerLoyaltyBalance(customerId, adjustPoints, adjustReason),
    onSuccess: () => {
      setAdjustError(null);
      setAdjustPoints(0);
      setAdjustReason("");
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "loyalty", "balance", customerId) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "loyalty", "ledger", customerId) });
    },
    onError: (err) => setAdjustError(err instanceof PosApiError ? err.message : "The adjustment could not be recorded."),
  });

  return (
    <div className="flex flex-col gap-4">
      <PosPanel title="Customer balance & ledger" description="Search a customer to see their current points and every ledger entry behind them.">
        <PosCustomerPicker label="Customer" onSelect={setCustomer} />

        {customer && (
          <div className="flex flex-col gap-4">
            {balanceQuery.isError ? (
              <ErrorState title="Balance could not be loaded" action={{ label: "Retry", onPress: () => balanceQuery.refetch() }} />
            ) : (
              <MetricStrip metrics={[{ label: customer.displayName, value: balanceQuery.data ? `${balanceQuery.data.balance.balance} pts` : "…" }]} />
            )}

            {canManage && balanceQuery.data && (
              <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted p-3">
                <p className="text-sm font-medium text-text">Manual adjustment</p>
                {adjustError && <PosAlert>{adjustError}</PosAlert>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
                  <NumberField label="Points (negative to deduct)" value={adjustPoints} onChange={setAdjustPoints} step={1} />
                  <TextField label="Reason" isRequired value={adjustReason} onChange={setAdjustReason} />
                </div>
                <div>
                  <Button variant="secondary" onPress={() => adjustMutation.mutate()} isDisabled={adjustPoints === 0 || !adjustReason.trim()} isLoading={adjustMutation.isPending}>
                    Apply adjustment
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </PosPanel>

      {customer && (
        <PosPanel title="Ledger history" description="Most recent 50 entries.">
          {ledgerQuery.isLoading ? (
            <PosLoading />
          ) : ledgerQuery.isError ? (
            <ErrorState title="Could not load ledger history" description="Something went wrong fetching this customer's ledger." action={{ label: "Retry", onPress: () => ledgerQuery.refetch() }} />
          ) : (
            <PosDataTable
              rows={ledgerQuery.data?.rows ?? []}
              empty="No ledger activity yet."
              columns={[
                { key: "created_at", header: "When", render: (entry) => dateTime(entry.created_at) },
                { key: "entry_type", header: "Type", render: (entry) => statusLabel(entry.entry_type) },
                { key: "reason", header: "Reason", render: (entry) => entry.reason || "—" },
                {
                  key: "points",
                  header: "Points",
                  numeric: true,
                  render: (entry) => (
                    <span className={Number(entry.points) >= 0 ? "text-success" : "text-danger"}>
                      {Number(entry.points) >= 0 ? "+" : ""}
                      {entry.points}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </PosPanel>
      )}
    </div>
  );
}
