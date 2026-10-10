"use client";

// Create or edit a cashier: the workspace user (an existing one — new people are invited under Users first), the cashier code, outlets and
// a default outlet, an optional short display name for receipts and an HR employee. Saved inactive unless activated now; a used cashier
// keeps its code and user.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, CheckboxGroup, ComboBox, ErrorState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner, NONE, orNull, withNone } from "@/features/items/item-format";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { listProfiles } from "@/features/pos/permission-profiles/api/profiles-api";

import {
  CASHIERS_BASE, createCashier, errorMessage, fieldErrors, getCashier, getCashierOptions, setCashierOutlets, updateCashier, type CashierDetail, type CashierOptions,
} from "../api/cashiers-api";

type Draft = { userId: string; code: string; displayName: string; employeeId: string; outletIds: string[]; defaultOutletId: string; permissionProfileId: string; notes: string; activate: boolean };

export function CashierFormScreen({ cashierId, outletId }: { cashierId?: string; outletId?: string | null }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "pos-cashiers", "options"), queryFn: getCashierOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "pos-cashiers", "one", cashierId), queryFn: () => getCashier(cashierId!), enabled: Boolean(cashierId) });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading cashier" rows={5} />;
  if (!options.data || (cashierId && !existing.data)) return <ErrorState title="Could not load the cashier" description={errorMessage(options.error ?? existing.error)} />;
  return <Form options={options.data} cashier={existing.data ?? null} initialOutletId={outletId ?? null} />;
}

function Form({ options, cashier, initialOutletId }: { options: CashierOptions; cashier: CashierDetail | null; initialOutletId: string | null }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => ({
    userId: cashier?.userId ?? NONE, code: cashier?.code ?? "", displayName: cashier?.displayName ?? "", employeeId: cashier?.employeeId ?? NONE,
    outletIds: cashier?.outletIds ?? (initialOutletId ? [initialOutletId] : []), defaultOutletId: cashier?.defaultOutletId ?? initialOutletId ?? NONE, notes: cashier?.notes ?? "",
    permissionProfileId: NONE,
    activate: false,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const can = cashier?.capabilities ?? options.capabilities;
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const editable = cashier ? can.edit : can.create;
  const assignAllowed = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("pos.permission_profiles.assign");
  const profiles = useQuery({ queryKey: scopedQueryKey(workspace, "pos-profiles", "list", { status: "active" }), queryFn: () => listProfiles({ status: "active" }),
    enabled: !cashier && assignAllowed });
  const locked = Boolean(cashier?.used);
  const members = options.members.filter((member) => !member.hasProfile || member.id === cashier?.userId);
  const employees = options.employees.filter((employee) => !employee.userId || employee.userId === (orNull(draft.userId) ?? ""));
  const defaults = options.outlets.filter((outlet) => draft.outletIds.includes(outlet.id)).map((outlet) => ({ value: outlet.id, label: outlet.label }));

  const save = useMutation({
    mutationFn: async () => {
      const common = { displayName: draft.displayName, employeeId: orNull(draft.employeeId), notes: draft.notes };
      if (!cashier) {
        return createCashier({ ...common, userId: orNull(draft.userId), code: draft.code.trim() || undefined, outletIds: draft.outletIds,
          defaultOutletId: orNull(draft.defaultOutletId), permissionProfileId: orNull(draft.permissionProfileId) ?? undefined, activate: draft.activate });
      }
      const input: Record<string, unknown> = { ...common, expectedVersion: cashier.version };
      if (!locked && draft.code.trim().toUpperCase() !== cashier.code) input.code = draft.code.trim();
      if (!locked && draft.userId !== cashier.userId) input.userId = orNull(draft.userId);
      let saved = editable ? await updateCashier(cashier.id, input) : cashier;
      const outletsChanged = JSON.stringify([...draft.outletIds].sort()) !== JSON.stringify([...cashier.outletIds].sort()) || (orNull(draft.defaultOutletId) ?? null) !== (cashier.defaultOutletId ?? null);
      if (can.assignOutlets && outletsChanged) saved = await setCashierOutlets(cashier.id, draft.outletIds, orNull(draft.defaultOutletId));
      return saved;
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-cashiers") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-outlets") });
      router.push(`${CASHIERS_BASE}/${saved.id}`);
    },
    onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); window.scrollTo({ top: 0, behavior: "smooth" }); },
  });

  return (
    <RecordFormPage
      header={{
        title: cashier ? `Edit ${cashier.code} · ${cashier.name}` : "New cashier",
        description: cashier ? "Their name and sign-in stay with their workspace user. Receipts already issued keep the code and name they were printed with."
          : "Choose an existing workspace user. Someone new is invited under Settings → Users first; they sign in with their own account.",
      }}
      banner={<ErrorBanner message={error} />}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(cashier ? `${CASHIERS_BASE}/${cashier.id}` : CASHIERS_BASE)}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>{cashier ? "Save changes" : "Create cashier"}</Button>
        </>
      }
    >
      <FormSection title="Cashier">
        <ComboBox label="Workspace user" isRequired selectedKey={draft.userId} placeholder="Search people" isDisabled={!editable || locked} errorMessage={errors.userId}
          options={withNone(members.map((member) => ({ value: member.id, label: `${member.name} · ${member.email}` })), "Choose a user")}
          onSelectionChange={(key) => key !== null && set("userId")(String(key))}
          description={locked ? "Fixed once used: sessions and receipts belong to this person." : "One cashier profile per person, whatever the number of outlets."} />
        <TextField label="Cashier code" value={draft.code} onChange={(value) => set("code")(value.toUpperCase().replace(/\s/g, ""))} errorMessage={errors.code}
          isDisabled={!editable || locked} placeholder={options.nextCode}
          description={locked ? "Fixed once used." : cashier ? "Unique in the company." : `Leave empty to use ${options.nextCode}.`} />
        <TextField label="Display name on receipts" value={draft.displayName} onChange={set("displayName")} isDisabled={!editable} description="Such as Amit S. Leave empty to use their name." />
        <Select label="Employee" selectedKey={draft.employeeId} isDisabled={!editable} onSelectionChange={(key) => set("employeeId")(String(key))}
          options={withNone(employees.map((employee) => ({ value: employee.id, label: employee.label })), "Not linked")} description="Optional link to their HR record." />
      </FormSection>

      <FormSection title="Outlets" description="Where this cashier may work. What they may do there comes from their POS role.">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <CheckboxGroup aria-label="Outlets" value={draft.outletIds} isDisabled={!can.assignOutlets}
            onChange={(value) => setDraft((current) => ({ ...current, outletIds: value, defaultOutletId: value.includes(current.defaultOutletId) ? current.defaultOutletId : NONE }))}>
            {options.outlets.map((outlet) => (
              <Checkbox key={outlet.id} value={outlet.id} isDisabled={cashier?.outletAccess.some((access) => access.outletId === outlet.id && access.inSession)}>
                {outlet.label}{outlet.active ? "" : " (inactive)"}{cashier?.outletAccess.some((access) => access.outletId === outlet.id && access.inSession) ? " — open session here" : ""}
              </Checkbox>
            ))}
          </CheckboxGroup>
          {errors.outletIds && <p className="text-sm text-danger">{errors.outletIds}</p>}
        </div>
        <Select label="Default outlet" selectedKey={draft.defaultOutletId} isDisabled={!can.assignOutlets || !defaults.length} errorMessage={errors.defaultOutletId}
          onSelectionChange={(key) => set("defaultOutletId")(String(key))} options={withNone(defaults, "None")} description="Open POS offers it first." />
      </FormSection>

      {!cashier && assignAllowed && (
        <FormSection title="Permissions" description="What this cashier may do at a POS and within which limits. Only active profiles can be assigned.">
          <Select label="Permission profile" selectedKey={draft.permissionProfileId} errorMessage={errors.permissionProfileId} onSelectionChange={(key) => set("permissionProfileId")(String(key))}
            options={withNone((profiles.data?.profiles ?? []).map((profile) => ({ value: profile.id, label: `${profile.name} (${profile.code})` })), "Assign later")} />
        </FormSection>
      )}

      <FormSection title="Notes" columns={1}>
        <TextArea aria-label="Notes" rows={2} value={draft.notes} onChange={set("notes")} isDisabled={!editable} />
        {!cashier && can.status && <Checkbox isSelected={draft.activate} onChange={set("activate")}>Activate now (needs at least one outlet and an active permission profile)</Checkbox>}
      </FormSection>
    </RecordFormPage>
  );
}
