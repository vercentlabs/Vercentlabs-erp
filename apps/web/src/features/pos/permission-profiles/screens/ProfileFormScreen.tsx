"use client";

// Create or edit a permission profile: name, code and description, then every catalogue permission grouped by area — granted or not, its
// limit (a percentage and / or an amount, or an explicit Unlimited when allowed) and whether a reason is required. Sensitive permissions
// must state their limit; a missing limit never means unlimited. The server validates everything again.
import { useMemo, useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner } from "@/features/items/item-format";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  PROFILES_BASE, createProfile, errorMessage, fieldErrors, getCatalogue, getProfile, issuesOf, updateProfile, type Area, type CatalogueEntry, type GrantInput, type Profile,
  type ProfileCapabilities,
} from "../api/profiles-api";
import { slugCode } from "../../shared/codes";
import { useSubmitKey } from "@/shared/http/submit-once";

type Row = { code: string; enabled: boolean; limitMode: GrantInput["limitMode"]; maxPercentage: string; maxAmount: string; maxAggregateAmount: string; requireReason: boolean };

export function ProfileFormScreen({ profileId }: { profileId?: string }) {
  const workspace = useWorkspaceContext();
  const catalogue = useQuery({ queryKey: scopedQueryKey(workspace, "pos-profiles", "catalogue"), queryFn: getCatalogue, staleTime: 300_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "pos-profiles", "one", profileId), queryFn: () => getProfile(profileId!), enabled: Boolean(profileId) });
  if (catalogue.isLoading || existing.isLoading) return <LoadingState label="Loading profile" rows={6} />;
  if (!catalogue.data || (profileId && !existing.data)) return <ErrorState title="Could not load the profile" description={errorMessage(catalogue.error ?? existing.error)} />;
  return <Form entries={catalogue.data.permissions} areas={catalogue.data.areas} capabilities={catalogue.data.capabilities} profile={existing.data ?? null} />;
}

function Form({ entries, areas, capabilities, profile }: { entries: CatalogueEntry[]; areas: Area[]; capabilities: ProfileCapabilities; profile: Profile | null }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [head, setHead] = useState({ code: profile?.code ?? "", name: profile?.name ?? "", description: profile?.description ?? "" });
  const [codeTyped, setCodeTyped] = useState(Boolean(profile));
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(entries.map((entry) => {
    const grant = profile?.grants.find((item) => item.code === entry.code);
    return [entry.code, {
      code: entry.code, enabled: grant?.enabled ?? false, limitMode: (grant?.limitMode === "hidden" ? "limited" : grant?.limitMode) ?? (entry.limitRequired ? "limited" : "not_applicable"),
      maxPercentage: grant?.maxPercentage === null || grant?.maxPercentage === undefined ? "" : String(grant.maxPercentage),
      maxAmount: grant?.maxAmount === null || grant?.maxAmount === undefined ? "" : String(grant.maxAmount),
      maxAggregateAmount: grant?.maxAggregateAmount === null || grant?.maxAggregateAmount === undefined ? "" : String(grant.maxAggregateAmount), requireReason: grant?.requireReason ?? entry.reason,
    }];
  })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Array<{ code: string; message: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const change = (code: string, patch: Partial<Row>) => setRows((current) => ({ ...current, [code]: { ...current[code], ...patch } }));
  const grouped = useMemo(() => areas.map((area) => ({ area, items: entries.filter((entry) => entry.area === area.code) })), [areas, entries]);
  const locked = Boolean(profile && (profile.status !== "draft" || profile.assignedCashiers > 0));

  const submit = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submit.run(async () => {
      const grants: GrantInput[] = entries.map((entry) => {
        const row = rows[entry.code];
        const limited = row.limitMode === "limited";
        return { code: entry.code, enabled: row.enabled, limitMode: entry.limits.length ? row.limitMode : "not_applicable", requireReason: row.requireReason,
          maxPercentage: limited && entry.limits.includes("percentage") && row.maxPercentage !== "" ? row.maxPercentage : null,
          maxAmount: limited && entry.limits.includes("amount") && row.maxAmount !== "" ? row.maxAmount : null,
          maxAggregateAmount: limited && entry.limits.includes("aggregate") && row.maxAggregateAmount !== "" ? row.maxAggregateAmount : null };
      });
      const input: Record<string, unknown> = { name: head.name, description: head.description, grants };
      if (!profile || (!locked && head.code.trim().toUpperCase() !== profile.code)) input.code = head.code;
      return profile ? updateProfile(profile.id, { ...input, expectedVersion: profile.version }) : createProfile(input);
    }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-profiles") });
      router.replace(`${PROFILES_BASE}/${saved.id}`);
    },
    onError: (failure) => { setErrors(fieldErrors(failure)); setProblems(issuesOf(failure)); setError(errorMessage(failure)); window.scrollTo({ top: 0, behavior: "smooth" }); },
  });

  return (
    <RecordFormPage
      header={{
        title: profile ? `Edit ${profile.name}` : "New permission profile",
        description: profile?.status === "active" ? "This profile is active: changes apply to the next action of every cashier holding it, and it must stay valid."
          : "Saved as a Draft. Activate it once every granted sensitive permission has its limit.",
      }}
      banner={
        <>
          <ErrorBanner message={error} />
          {problems.length > 0 && <Notice tone="danger"><ul className="list-disc pl-5">{problems.map((problem, index) => <li key={index}>{problem.message}</li>)}</ul></Notice>}
        </>
      }
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(profile ? `${PROFILES_BASE}/${profile.id}` : PROFILES_BASE)}>Cancel</Button>
          <Button isDisabled={save.isPending || save.isSuccess} variant="primary" isLoading={save.isPending || save.isSuccess} onPress={() => { setError(null); setProblems([]); save.mutate(); }}>{profile ? "Save changes" : "Create profile"}</Button>
        </>
      }
    >
      <FormSection title="Profile">
        {/* A new profile's code follows its name (Senior Cashier -> SENIOR-CASHIER) until the person types one. */}
        <TextField label="Name" isRequired value={head.name} errorMessage={errors.name} description="Such as Senior Cashier."
          onChange={(name) => setHead((current) => ({ ...current, name, code: codeTyped ? current.code : slugCode(name) }))} />
        <TextField label="Code" isRequired value={head.code} onChange={(code) => { setCodeTyped(true); setHead((current) => ({ ...current, code: code.toUpperCase().replace(/\s/g, "") })); }}
          errorMessage={errors.code} isDisabled={locked}
          description={locked ? "Fixed once activated or assigned." : codeTyped ? "Unique in the company, such as SENIOR-CASHIER." : "Proposed from the name. Type your own to change it."} />
        <TextArea className="sm:col-span-2" label="Description" rows={2} value={head.description} onChange={(description) => setHead((current) => ({ ...current, description }))} />
      </FormSection>

      {grouped.map(({ area, items }) => (
        <FormSection key={area.code} title={area.label} columns={1}>
          <div className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border">
            {items.map((entry) => {
              const row = rows[entry.code];
              const error = errors[entry.code];
              return (
                <div key={entry.code} className="grid grid-cols-1 gap-2 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7rem_9rem_auto] md:items-center">
                  <Checkbox isSelected={row.enabled} onChange={(enabled) => change(entry.code, { enabled })}>
                    <span className="flex flex-col"><span className="font-medium">{entry.label}</span><span className="text-xs text-text-muted">{entry.description}</span></span>
                  </Checkbox>
                  {entry.limits.length ? (
                    <Select aria-label={`${entry.label} limit`} size="compact" selectedKey={row.limitMode} isDisabled={!row.enabled}
                      onSelectionChange={(key) => change(entry.code, { limitMode: String(key) as Row["limitMode"] })}
                      options={[{ value: "limited", label: "Limited" }, ...(capabilities.configureUnlimited || row.limitMode === "unlimited" ? [{ value: "unlimited", label: "Unlimited" }] : []),
                        ...(!entry.limitRequired ? [{ value: "not_applicable", label: "No limit needed" }] : [])]} />
                  ) : <span className="text-xs text-text-muted">No limit</span>}
                  {entry.limits.includes("percentage") ? (
                    <TextField aria-label={`${entry.label} maximum percentage`} placeholder="Max %" value={row.maxPercentage} isDisabled={!row.enabled || row.limitMode !== "limited"}
                      onChange={(maxPercentage) => change(entry.code, { maxPercentage })} />
                  ) : <span />}
                  {entry.limits.includes("amount") ? (
                    <div className="flex flex-col gap-1">
                      <TextField aria-label={`${entry.label} maximum amount`} placeholder={entry.limits.includes("aggregate") ? "Max per discount" : "Max amount"} value={row.maxAmount}
                        isDisabled={!row.enabled || row.limitMode !== "limited"} onChange={(maxAmount) => change(entry.code, { maxAmount })} />
                      {/* Item Discounts: the most this cashier may take off one sale in all (empty: the per-discount amount). */}
                      {entry.limits.includes("aggregate") && (
                        <TextField aria-label={`${entry.label} maximum per sale`} placeholder="Max per sale" value={row.maxAggregateAmount}
                          isDisabled={!row.enabled || row.limitMode !== "limited"} onChange={(maxAggregateAmount) => change(entry.code, { maxAggregateAmount })} />
                      )}
                    </div>
                  ) : <span />}
                  <Checkbox isSelected={row.requireReason || entry.reason} isDisabled={entry.reason || !row.enabled} onChange={(requireReason) => change(entry.code, { requireReason })}>Reason</Checkbox>
                  {error && <p className="text-sm text-danger md:col-span-5">{error}</p>}
                </div>
              );
            })}
          </div>
        </FormSection>
      ))}
    </RecordFormPage>
  );
}
