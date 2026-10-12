"use client";

// Receipt set-up (administrators): each outlet's receipt footer (message, return policy, support text, the scannable receipt reference) and
// each counter's receipt printers — paper width, the counter's default, automatic printing, copies — with a test page that says it is not a
// tax invoice. Browser printing is what works today; a print agent or network bridge is saved by its device name but shows "not connected"
// until a bridge exists, and printing then falls back to the browser.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, Switch, TextField } from "@vercentlabs/design-system";
import type { PosReceiptBranding, PosReceiptPrinter, PosReceiptWidth } from "@vercentlabs/api";

import { listOutlets } from "@/features/pos/outlets/api/outlets-api";
import { addReceiptPrinter, listReceiptPrinters, printHtml, reportPrintJob, saveReceiptBranding, testReceiptPrinter, updateReceiptPrinter } from "@/features/pos/receipts/api/printing-api";
import { listTerminals, type Terminal } from "@/features/pos/terminals/api/terminals-api";
import { PosApiError, request } from "@/features/pos/shared/http";
import { PosPanel } from "@/features/pos/shared/PosUi";

const WIDTHS = [{ value: "80", label: "80 mm roll" }, { value: "58", label: "58 mm roll" }, { value: "210", label: "A4" }];
const MODES = [{ value: "browser", label: "Browser printing" }, { value: "print_agent", label: "Print agent (not connected yet)" }, { value: "network_bridge", label: "Network bridge (not connected yet)" }];

function useRunner() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  async function run(work: () => Promise<string | void>) {
    setBusy(true);
    setMessage(null);
    try { const text = await work(); if (text) setMessage({ error: false, text }); } catch (failure) {
      setMessage({ error: true, text: failure instanceof PosApiError ? failure.message : "Could not save." });
    } finally { setBusy(false); }
  }
  return { busy, message, run };
}

function OutletBranding({ branding, onSaved }: { branding: PosReceiptBranding; onSaved: () => void }) {
  const [draft, setDraft] = useState({ receiptMessage: branding.receiptMessage ?? "", returnPolicy: branding.returnPolicy ?? "", supportText: branding.supportText ?? "",
    referenceCodeEnabled: branding.referenceCodeEnabled });
  const { busy, message, run } = useRunner();
  const set = <K extends keyof typeof draft>(key: K) => (value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Receipt message" description="Printed under the total. 200 characters at most." value={draft.receiptMessage} onChange={set("receiptMessage")} maxLength={200} />
        <TextField label="Support text" description="A phone number or help line." value={draft.supportText} onChange={set("supportText")} maxLength={200} />
        <TextField label="Return policy" className="sm:col-span-2" value={draft.returnPolicy} onChange={set("returnPolicy")} maxLength={500} />
      </div>
      <Switch isSelected={draft.referenceCodeEnabled} onChange={set("referenceCodeEnabled")}>Print a scannable receipt reference (to find the sale for a return)</Switch>
      {message && <p className={`text-sm ${message.error ? "text-danger-emphasis" : "text-text-muted"}`}>{message.text}</p>}
      <div>
        <Button variant="secondary" size="compact" isLoading={busy} onPress={() => run(async () => {
          await saveReceiptBranding(branding.storeId, { receiptMessage: draft.receiptMessage || null, returnPolicy: draft.returnPolicy || null, supportText: draft.supportText || null,
            referenceCodeEnabled: draft.referenceCodeEnabled });
          onSaved();
          return "Saved. Receipts already issued keep the text they were printed with.";
        })}>Save receipt text</Button>
      </div>
    </div>
  );
}

function PrinterRow({ printer, onSaved }: { printer: PosReceiptPrinter; onSaved: () => void }) {
  const { busy, message, run } = useRunner();
  const change = (input: Record<string, unknown>) => run(async () => {
    await updateReceiptPrinter(printer.id, { name: printer.name, connectionMode: printer.connectionMode, paperWidthMm: printer.paperWidthMm, isDefault: printer.isDefault,
      autoPrint: printer.autoPrint, copies: printer.copies, merchantCopy: printer.merchantCopy, bridgeDeviceReference: printer.bridgeDeviceReference, enabled: printer.enabled,
      expectedVersion: printer.version, ...input });
    onSaved();
  });
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-surface-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{printer.name} · {printer.paperWidthMm === 210 ? "A4" : `${printer.paperWidthMm} mm`}</p>
        <div className="flex flex-wrap gap-1.5">
          {printer.isDefault && <StatusBadge tone="success">Default</StatusBadge>}
          {!printer.enabled && <StatusBadge tone="neutral">Disabled</StatusBadge>}
          <StatusBadge tone={printer.connectionStatus === "browser" ? "neutral" : "warning"}>{printer.connectionStatus === "browser" ? "Browser" : "Not connected"}</StatusBadge>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Switch isSelected={printer.autoPrint} onChange={(value) => change({ autoPrint: value })} isDisabled={busy}>Print automatically after each sale</Switch>
        <Switch isSelected={printer.merchantCopy} onChange={(value) => change({ merchantCopy: value })} isDisabled={busy}>Merchant copy</Switch>
        <Switch isSelected={printer.enabled} onChange={(value) => change({ enabled: value })} isDisabled={busy}>Enabled</Switch>
      </div>
      <div className="flex flex-wrap gap-2">
        {!printer.isDefault && <Button variant="ghost" size="compact" isDisabled={busy} onPress={() => change({ isDefault: true })}>Make default</Button>}
        <Button variant="secondary" size="compact" isLoading={busy} onPress={() => run(async () => {
          const test = await testReceiptPrinter(printer.id);
          if (printer.connectionMode !== "browser") return "The bridge is not connected. Printing the test page through the browser.";
          const outcome = await printHtml(test.html);
          await reportPrintJob(test.job.id, outcome === "dialog_opened" ? "dialog_opened" : "failed").catch(() => undefined);
          return outcome === "dialog_opened" ? "Test page sent to the print dialog. Check the paper and the width." : "The print dialog did not open.";
        })}>Print test page</Button>
      </div>
      {message && <p className={`text-sm ${message.error ? "text-danger-emphasis" : "text-text-muted"}`}>{message.text}</p>}
    </div>
  );
}

function TerminalPrinters({ terminal }: { terminal: Terminal }) {
  const queryClient = useQueryClient();
  const key = ["pos-receipt-printers", terminal.id];
  const printers = useQuery({ queryKey: key, queryFn: () => listReceiptPrinters(terminal.id) });
  const [draft, setDraft] = useState({ name: "", paperWidthMm: "80", connectionMode: "browser", bridgeDeviceReference: "" });
  const { busy, message, run } = useRunner();
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: key }); };
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-sm font-medium">{terminal.code} · {terminal.name}</p>
      {printers.data?.length === 0 && <p className="text-xs text-text-muted">No printer yet — receipts print through the browser at 80 mm.</p>}
      {printers.data?.map((printer) => <PrinterRow key={`${printer.id}:${printer.version}`} printer={printer} onSaved={refresh} />)}
      <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-4">
        <TextField label="Printer name" value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} />
        <Select label="Paper" selectedKey={draft.paperWidthMm} onSelectionChange={(value) => setDraft((current) => ({ ...current, paperWidthMm: String(value) }))} options={WIDTHS} />
        <Select label="Connection" selectedKey={draft.connectionMode} onSelectionChange={(value) => setDraft((current) => ({ ...current, connectionMode: String(value) }))} options={MODES} />
        {draft.connectionMode !== "browser"
          ? <TextField label="Device name" description="Letters, digits, . _ : - (never a URL)" value={draft.bridgeDeviceReference} onChange={(value) => setDraft((current) => ({ ...current, bridgeDeviceReference: value }))} />
          : <span />}
      </div>
      {message && <p className={`text-sm ${message.error ? "text-danger-emphasis" : "text-text-muted"}`}>{message.text}</p>}
      <div>
        <Button variant="secondary" size="compact" isLoading={busy} isDisabled={!draft.name.trim()} onPress={() => run(async () => {
          await addReceiptPrinter(terminal.id, { name: draft.name.trim(), paperWidthMm: Number(draft.paperWidthMm) as PosReceiptWidth, connectionMode: draft.connectionMode,
            bridgeDeviceReference: draft.connectionMode === "browser" ? null : draft.bridgeDeviceReference.trim() || null });
          setDraft({ name: "", paperWidthMm: "80", connectionMode: "browser", bridgeDeviceReference: "" });
          refresh();
        })}>Add printer</Button>
      </div>
    </div>
  );
}

export function ReceiptSettings() {
  const queryClient = useQueryClient();
  const outlets = useQuery({ queryKey: ["pos-receipt-outlets"], queryFn: () => listOutlets().then((result) => result.outlets.filter((outlet) => outlet.isActive)) });
  const terminals = useQuery({ queryKey: ["pos-receipt-terminals"], queryFn: () => listTerminals().then((result) => result.terminals.filter((terminal) => terminal.isActive)) });
  const [outletId, setOutletId] = useState<string | null>(null);
  const selected = outletId ?? outlets.data?.[0]?.id ?? null;
  const branding = useQuery({
    queryKey: ["pos-receipt-branding", selected], enabled: Boolean(selected),
    queryFn: () => request<{ branding: PosReceiptBranding }>(`/outlets/${selected}/receipt-branding`).then((result) => result.branding),
  });
  if (!outlets.data?.length) return null;
  return (
    <PosPanel title="Receipts & printers" description="What each outlet prints on its receipts, and the printer at each counter. Receipts are printed from the finalized sale — printing never changes it.">
      <Select label="Outlet" className="sm:max-w-sm" selectedKey={selected ?? undefined} onSelectionChange={(key) => setOutletId(String(key))}
        options={outlets.data.map((outlet) => ({ value: outlet.id, label: `${outlet.code} · ${outlet.name}` }))} />
      {branding.data && <OutletBranding key={`${branding.data.storeId}:${branding.dataUpdatedAt}`} branding={branding.data}
        onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["pos-receipt-branding", selected] }); }} />}
      {(terminals.data ?? []).filter((terminal) => terminal.outletId === selected).map((terminal) => <TerminalPrinters key={terminal.id} terminal={terminal} />)}
    </PosPanel>
  );
}
