"use client";

// F306 — Loyalty program administration + a real-ledger customer balance
// lookup. Deliberately follows this rebuilt POS frontend's OWN established
// pattern (plain panels/divs, as PosOverviewScreen.tsx and
// PosCheckoutScreen.tsx already use) rather than the EnterpriseListPage/
// EnterpriseDataGrid pattern used elsewhere in the app -- neither of those
// two POS screens uses that pattern either, and no promotions/coupons
// settings screen exists yet in this branch to follow instead. The ledger
// view below shows REAL ledger entries (never a single balance number with
// no history), per this feature's own non-negotiable.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, NumberField, StatusBadge, TextField } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import {
  adjustPosCustomerLoyaltyBalance,
  getPosCustomerLoyaltyBalance,
  getPosLoyaltyProgram,
  listPosCustomerLoyaltyLedger,
  setPosLoyaltyProgramActive,
  upsertPosLoyaltyProgram,
} from "@/features/pos/loyalty/api/loyalty-api";

export function PosLoyaltyScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.loyaltyManage);

  const programQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "loyalty", "program"), queryFn: getPosLoyaltyProgram });
  const program = programQuery.data?.record ?? null;

  const [name, setName] = useState("");
  const [earnRate, setEarnRate] = useState(0.1);
  const [redemptionValue, setRedemptionValue] = useState(0.5);
  const [minRedemption, setMinRedemption] = useState(0);
  const [maxRedemptionPerSale, setMaxRedemptionPerSale] = useState(0);
  const [maxPercentOfPayable, setMaxPercentOfPayable] = useState(0);
  const [minEligibleAmount, setMinEligibleAmount] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [lookupCustomerId, setLookupCustomerId] = useState("");
  const [adjustPoints, setAdjustPoints] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);

  const balanceQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "loyalty", "balance", lookupCustomerId),
    queryFn: () => getPosCustomerLoyaltyBalance(lookupCustomerId),
    enabled: Boolean(lookupCustomerId),
  });
  const ledgerQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "loyalty", "ledger", lookupCustomerId),
    queryFn: () => listPosCustomerLoyaltyLedger(lookupCustomerId, 50),
    enabled: Boolean(lookupCustomerId),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertPosLoyaltyProgram({
        name,
        earnRatePointsPerCurrency: earnRate,
        redemptionValuePerPoint: redemptionValue,
        minRedemptionPoints: minRedemption,
        maxRedemptionPointsPerSale: maxRedemptionPerSale > 0 ? maxRedemptionPerSale : null,
        maxRedemptionPercentOfPayable: maxPercentOfPayable > 0 ? maxPercentOfPayable : null,
        minEligibleSaleAmount: minEligibleAmount,
      }),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "loyalty", "program") });
    },
    onError: (err) => setFormError(err instanceof PosApiError ? err.message : "The program could not be saved."),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (active: boolean) => setPosLoyaltyProgramActive(active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "loyalty", "program") }),
  });

  const adjustMutation = useMutation({
    mutationFn: () => adjustPosCustomerLoyaltyBalance(lookupCustomerId, adjustPoints, adjustReason),
    onSuccess: () => {
      setLookupError(null);
      setAdjustPoints(0);
      setAdjustReason("");
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "loyalty", "balance", lookupCustomerId) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "loyalty", "ledger", lookupCustomerId) });
    },
    onError: (err) => setLookupError(err instanceof PosApiError ? err.message : "The adjustment could not be recorded."),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Loyalty</h1>
        <p className="text-sm text-text-secondary">Configure the loyalty program and look up a customer&apos;s real points balance and ledger history.</p>
      </div>

      <div className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-text">Program</h2>
          {program && <StatusBadge tone={program.status === "active" ? "success" : "neutral"}>{program.status}</StatusBadge>}
        </div>
        {!canManage ? (
          program ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Row label="Earn rate" value={`${program.earn_rate_points_per_currency} pts / currency unit`} />
              <Row label="Redemption value" value={`${program.redemption_value_per_point} / pt`} />
              <Row label="Min redemption" value={String(program.min_redemption_points)} />
              <Row label="Max per sale" value={program.max_redemption_points_per_sale ?? "No limit"} />
            </dl>
          ) : (
            <p className="text-sm text-text-secondary">No loyalty program is configured yet.</p>
          )
        ) : (
          <div className="flex flex-col gap-3">
            {formError && (
              <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                {formError}
              </p>
            )}
            <TextField label="Program name" value={name || program?.name || ""} onChange={setName} />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Earn rate (points per currency unit)" value={earnRate || Number(program?.earn_rate_points_per_currency ?? 0.1)} onChange={setEarnRate} minValue={0} step={0.01} />
              <NumberField label="Redemption value (currency per point)" value={redemptionValue || Number(program?.redemption_value_per_point ?? 0.5)} onChange={setRedemptionValue} minValue={0} step={0.01} />
              <NumberField label="Minimum points to redeem" value={minRedemption} onChange={setMinRedemption} minValue={0} />
              <NumberField label="Max points per sale (0 = no limit)" value={maxRedemptionPerSale} onChange={setMaxRedemptionPerSale} minValue={0} />
              <NumberField label="Max redemption % of payable (0 = no limit)" value={maxPercentOfPayable} onChange={setMaxPercentOfPayable} minValue={0} maxValue={100} />
              <NumberField label="Minimum eligible sale amount to earn" value={minEligibleAmount} onChange={setMinEligibleAmount} minValue={0} step={0.01} />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onPress={() => saveMutation.mutate()} isLoading={saveMutation.isPending} isDisabled={!(name || program?.name) || earnRate <= 0 || redemptionValue <= 0}>
                Save program
              </Button>
              {program && (
                <Button variant="secondary" onPress={() => toggleActiveMutation.mutate(program.status !== "active")} isLoading={toggleActiveMutation.isPending}>
                  {program.status === "active" ? "Deactivate" : "Activate"}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Customer balance &amp; ledger</h2>
        <div className="flex items-end gap-2">
          <TextField label="Customer ID" value={customerId} onChange={setCustomerId} className="flex-1" />
          <Button variant="secondary" onPress={() => setLookupCustomerId(customerId.trim())} isDisabled={!customerId.trim()}>
            Look up
          </Button>
        </div>

        {lookupCustomerId && (
          <div className="mt-4 flex flex-col gap-4">
            {balanceQuery.isError && <ErrorState title="Customer not found" description="Check the customer ID and try again." />}
            {balanceQuery.data && (
              <p className="text-lg font-semibold text-text">
                Balance: <span className="tabular-nums">{balanceQuery.data.balance.balance}</span> points
              </p>
            )}

            {canManage && balanceQuery.data && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border-strong p-3">
                <p className="text-sm font-medium text-text">Manual adjustment</p>
                {lookupError && <p className="text-sm text-danger">{lookupError}</p>}
                <div className="flex items-end gap-2">
                  <NumberField label="Points (negative to deduct)" value={adjustPoints} onChange={setAdjustPoints} step={1} />
                  <TextField label="Reason" value={adjustReason} onChange={setAdjustReason} className="flex-1" />
                  <Button variant="secondary" onPress={() => adjustMutation.mutate()} isDisabled={adjustPoints === 0 || !adjustReason.trim()} isLoading={adjustMutation.isPending}>
                    Apply
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-medium text-text">Ledger history</p>
              <div className="max-h-96 overflow-y-auto rounded-[var(--radius-control)] border border-border-strong">
                {!ledgerQuery.data?.rows?.length ? (
                  <p className="p-3 text-sm text-text-muted">No ledger activity yet.</p>
                ) : (
                  ledgerQuery.data.rows.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between border-b border-border px-3 py-2 text-sm last:border-0">
                      <div>
                        <span className="font-medium text-text">{entry.entry_type}</span>
                        <span className="ml-2 text-text-muted">{new Date(entry.created_at).toLocaleString()}</span>
                        {entry.reason && <span className="ml-2 text-text-muted">— {entry.reason}</span>}
                      </div>
                      <span className={`tabular-nums ${Number(entry.points) >= 0 ? "text-success" : "text-danger"}`}>
                        {Number(entry.points) >= 0 ? "+" : ""}
                        {entry.points}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-text">{value}</dd>
    </div>
  );
}
