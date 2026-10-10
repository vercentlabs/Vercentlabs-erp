"use client";

// Create or set up a POS terminal: General, Inventory, Cash & Payments, Documents and Hardware. Everything not overridden here comes from the
// outlet. A used terminal keeps its outlet and code; posting-critical settings wait for its open session to close (the server says so).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, CheckboxGroup, ErrorState, RecordFormPage, Select, Switch, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner, NONE, orNull, withNone } from "@/features/items/item-format";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  TERMINALS_BASE, createTerminal, errorMessage, fieldErrors, getTerminal, getTerminalOptions, updateTerminal, type TerminalDetail, type TerminalOptions,
} from "../api/terminals-api";

type Draft = {
  outletId: string; code: string; name: string; notes: string; sellingLocationId: string; cashManagementEnabled: boolean; cashAccountId: string;
  allMethods: boolean; paymentMethods: string[]; paymentDeviceRef: string; receiptPrefix: string; deviceLabel: string; receiptPrinter: string;
  cashDrawer: boolean; barcodeScanning: boolean; reason: string;
};

export function TerminalFormScreen({ terminalId, outletId }: { terminalId?: string; outletId?: string | null }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "pos-terminals", "options"), queryFn: getTerminalOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "pos-terminals", "one", terminalId), queryFn: () => getTerminal(terminalId!), enabled: Boolean(terminalId) });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading terminal" rows={5} />;
  if (!options.data || (terminalId && !existing.data)) return <ErrorState title="Could not load the terminal" description={errorMessage(options.error ?? existing.error)} />;
  return <Form options={options.data} terminal={existing.data ?? null} initialOutletId={outletId ?? null} />;
}

function Form({ options, terminal, initialOutletId }: { options: TerminalOptions; terminal: TerminalDetail | null; initialOutletId: string | null }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => ({
    outletId: terminal?.outletId ?? initialOutletId ?? options.outlets.find((entry) => entry.active)?.id ?? options.outlets[0]?.id ?? "",
    code: terminal?.code ?? "", name: terminal?.name ?? "", notes: terminal?.notes ?? "", sellingLocationId: terminal?.sellingLocationId ?? NONE,
    cashManagementEnabled: terminal?.cashManagementEnabled ?? true, cashAccountId: terminal?.cashAccountId ?? NONE,
    allMethods: !terminal?.paymentMethods, paymentMethods: terminal?.paymentMethods ?? [], paymentDeviceRef: terminal?.paymentDeviceRef ?? "",
    receiptPrefix: terminal?.receiptPrefix ?? "", deviceLabel: terminal?.deviceLabel ?? "", receiptPrinter: terminal?.receiptPrinter ?? "",
    cashDrawer: terminal?.cashDrawer ?? false, barcodeScanning: terminal?.barcodeScanning ?? true, reason: "",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const can = terminal?.capabilities ?? options.capabilities;
  const creating = !terminal;
  const edit = {
    general: creating ? can.create : can.edit, inventory: creating ? can.create : can.configureInventory, cash: can.configureCash,
    payments: can.configurePayments, numbering: creating ? can.create : can.configureNumbering, hardware: creating ? can.create : can.configureHardware,
  };
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const outlet = options.outlets.find((entry) => entry.id === draft.outletId);
  const locations = options.locations.filter((entry) => entry.warehouseId === outlet?.warehouseId).map((entry) => ({ value: entry.id, label: entry.label }));
  const outletMethods = options.paymentMethods.filter((method) => outlet?.methods.includes(method.code));
  const locked = Boolean(terminal?.used);
  const codeChanged = Boolean(terminal && draft.code.trim().toUpperCase() !== terminal.code);

  const save = useMutation({
    mutationFn: () => {
      const input: Record<string, unknown> = { name: draft.name.trim(), notes: draft.notes };
      if (creating || (!locked && draft.outletId !== terminal?.outletId)) input.outletId = draft.outletId;
      if (creating || codeChanged) input.code = draft.code.trim();
      if (edit.inventory) input.sellingLocationId = orNull(draft.sellingLocationId);
      if (edit.cash) Object.assign(input, { cashManagementEnabled: draft.cashManagementEnabled, cashAccountId: orNull(draft.cashAccountId) });
      if (edit.payments) Object.assign(input, { paymentMethods: draft.allMethods ? null : draft.paymentMethods, paymentDeviceRef: draft.paymentDeviceRef });
      if (edit.numbering && draft.receiptPrefix.trim()) input.receiptPrefix = draft.receiptPrefix.trim();
      if (edit.hardware) Object.assign(input, { deviceLabel: draft.deviceLabel, receiptPrinter: draft.receiptPrinter, cashDrawer: draft.cashDrawer, barcodeScanning: draft.barcodeScanning });
      return terminal ? updateTerminal(terminal.id, { ...input, expectedVersion: terminal.version, reason: draft.reason.trim() || undefined }) : createTerminal(input);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-terminals") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-outlets") });
      router.push(`${TERMINALS_BASE}/${saved.id}`);
    },
    onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); window.scrollTo({ top: 0, behavior: "smooth" }); },
  });

  return (
    <RecordFormPage
      header={{
        title: terminal ? `Set up ${terminal.code} · ${terminal.name}` : "New POS terminal",
        description: terminal ? "New sessions and sales use the changes; recorded sales keep the terminal, location and receipt numbers they were made with."
          : "A register inside an outlet. It sells from the outlet's warehouse and takes the outlet's prices, tax and payment methods unless you narrow them here.",
      }}
      banner={
        <>
          <ErrorBanner message={error} />
          {terminal?.currentSession && <Notice tone="warning">Session {terminal.currentSession} is open on this terminal. The name, notes and hardware can change now; outlet, location, cash, payment and receipt settings wait until it closes.</Notice>}
        </>
      }
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(terminal ? `${TERMINALS_BASE}/${terminal.id}` : TERMINALS_BASE)}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>{terminal ? "Save changes" : "Create terminal"}</Button>
        </>
      }
    >
      <FormSection title="General">
        <Select label="Outlet" isRequired selectedKey={draft.outletId} isDisabled={!edit.general || locked} errorMessage={errors.outletId}
          onSelectionChange={(key) => setDraft((current) => ({ ...current, outletId: String(key), sellingLocationId: NONE, paymentMethods: [] }))}
          options={options.outlets.map((entry) => ({ value: entry.id, label: `${entry.label}${entry.active ? "" : " (inactive)"}` }))}
          description={locked ? "A terminal that has been used stays at its outlet." : "Its company, warehouse, prices and tax come from here."} />
        <TextField label="Code" isRequired value={draft.code} onChange={(value) => set("code")(value.toUpperCase().replace(/\s/g, ""))} errorMessage={errors.code}
          isDisabled={!edit.general || locked} description={locked ? "Fixed once used: reports identify the register by it." : "Unique at the outlet, such as T01."} />
        <TextField label="Name" isRequired value={draft.name} onChange={set("name")} errorMessage={errors.name} isDisabled={!edit.general} description="Such as Counter 1." />
        {codeChanged && <TextField label="Reason for the new code" value={draft.reason} onChange={set("reason")} />}
        <TextArea label="Notes" rows={2} value={draft.notes} onChange={set("notes")} isDisabled={!edit.general} />
      </FormSection>

      <FormSection title="Inventory" description="The warehouse is always the outlet's. The terminal may sell from a location inside it.">
        <Select label="Selling location" selectedKey={draft.sellingLocationId} isDisabled={!edit.inventory} errorMessage={errors.sellingLocationId}
          onSelectionChange={(key) => set("sellingLocationId")(String(key))} options={withNone(locations, "Outlet's selling location")}
          description="Such as COUNTER-01. Without one, the outlet's selling location is used." />
      </FormSection>

      <FormSection title="Cash & Payments" description="Payment methods are always within the outlet's; a terminal can only narrow them.">
        <Switch isSelected={draft.cashManagementEnabled} isDisabled={!edit.cash} onChange={set("cashManagementEnabled")}>
          Handles cash (opening float, cash sales and refunds, closing count)
        </Switch>
        {draft.cashManagementEnabled && (
          <Select label="Cash account" selectedKey={draft.cashAccountId} isDisabled={!edit.cash} errorMessage={errors.cashAccountId}
            onSelectionChange={(key) => set("cashAccountId")(String(key))} options={withNone(options.cashAccounts.map((entry) => ({ value: entry.id, label: entry.label })), "Outlet's cash account")} />
        )}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Checkbox isSelected={draft.allMethods} isDisabled={!edit.payments} onChange={set("allMethods")}>
            Every payment method the outlet accepts ({outletMethods.map((method) => method.label).join(", ") || "none yet"})
          </Checkbox>
          {!draft.allMethods && (
            <CheckboxGroup aria-label="Payment methods this terminal takes" value={draft.paymentMethods} onChange={set("paymentMethods")} isDisabled={!edit.payments}>
              {outletMethods.map((method) => <Checkbox key={method.code} value={method.code}>{method.label}</Checkbox>)}
            </CheckboxGroup>
          )}
          {errors.paymentMethods && <p className="text-sm text-danger">{errors.paymentMethods}</p>}
        </div>
        <TextField label="Payment device" value={draft.paymentDeviceRef} onChange={set("paymentDeviceRef")} isDisabled={!edit.payments}
          description="The card machine or UPI QR this counter uses, such as CARD-001. Never a card number or secret." />
      </FormSection>

      <FormSection title="Documents" description="Receipts are numbered by the shared numbering service in this series.">
        <TextField label="Receipt series" value={draft.receiptPrefix} onChange={(value) => set("receiptPrefix")(value.toUpperCase())} errorMessage={errors.receiptPrefix}
          isDisabled={!edit.numbering} placeholder={outlet && draft.code ? `${outlet.code}-${draft.code}` : "PUN-T01"}
          description={creating ? "Leave empty to use OUTLET-CODE, such as PUN-T01." : "Receipts already issued keep their numbers."} />
      </FormSection>

      <FormSection title="Hardware" description="What is at the counter. The terminal stays the same register when its computer is replaced.">
        <TextField label="Device label" value={draft.deviceLabel} onChange={set("deviceLabel")} isDisabled={!edit.hardware} description="Such as the PC's asset tag." />
        <TextField label="Receipt printer" value={draft.receiptPrinter} onChange={set("receiptPrinter")} isDisabled={!edit.hardware} description="Such as Browser print or EPSON TM-T82." />
        <Checkbox isSelected={draft.cashDrawer} isDisabled={!edit.hardware || !draft.cashManagementEnabled} onChange={set("cashDrawer")}>Cash drawer connected</Checkbox>
        <Checkbox isSelected={draft.barcodeScanning} isDisabled={!edit.hardware} onChange={set("barcodeScanning")}>Barcode scanning</Checkbox>
      </FormSection>
    </RecordFormPage>
  );
}
