"use client";

// Purchase Bills › By email (report Phase 3): the bills suppliers emailed to the company's bills address, each with what its e-invoice
// QR says. Make bill opens the bill form filled in from it; Not a bill sets it aside with a reason.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Button, Dialog, EmptyState, ErrorState, LinkButton, Select, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { calendarDate, dateTime, money } from "@/features/procurement/shared/format";
import { billInboxFileUrl, errorMessage, listBillInbox, setAsideBillInbox, type BillInboxEntry } from "../api/supplier-bills-api";

export function BillInbox({ canCreate }: { canCreate: boolean }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState("new");
  const [setting, setSetting] = useState<BillInboxEntry | null>(null);
  const query = useQuery({ queryKey: ["procurement", "bill-inbox", view], queryFn: () => listBillInbox(view) });
  const restore = useMutation({ mutationFn: (id: string) => setAsideBillInbox(id, { restore: true }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["procurement", "bill-inbox"] }) });
  if (query.isLoading) return <LoadingState label="Loading emailed bills" rows={4} />;
  if (query.isError) return <ErrorState title="Could not load emailed bills" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const { rows, addressReady } = query.data!;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Select aria-label="Show" size="compact" className="sm:w-56" selectedKey={view} onSelectionChange={(value) => setView(String(value))}
          options={[{ value: "new", label: "Waiting to be billed" }, { value: "billed", label: "Made into bills" }, { value: "set_aside", label: "Not bills" }, { value: "all", label: "All" }]} />
        {!addressReady && <p className="text-sm text-text-muted">No bills address yet. <Link className="text-brand hover:underline" href="/settings/integrations?tab=inbound-email">Set one up in Inbound email</Link>.</p>}
      </div>
      {restore.error && <Notice>{errorMessage(restore.error)}</Notice>}
      {!rows.length ? <EmptyState title={view === "new" ? "No emailed bills waiting" : "Nothing here"} description="Bills suppliers email to the bills address appear here, with their e-invoice QR read." /> : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border">
          {rows.map((entry) => <InboxRow key={entry.id} entry={entry} canCreate={canCreate} onSetAside={() => setSetting(entry)} onRestore={() => restore.mutate(entry.id)} restoring={restore.isPending && restore.variables === entry.id} />)}
        </ul>
      )}
      {setting && <SetAsideDialog entry={setting} onClose={() => setSetting(null)} onDone={() => { setSetting(null); void queryClient.invalidateQueries({ queryKey: ["procurement", "bill-inbox"] }); }} />}
    </div>
  );
}

function InboxRow({ entry, canCreate, onSetAside, onRestore, restoring }: { entry: BillInboxEntry; canCreate: boolean; onSetAside: () => void; onRestore: () => void; restoring: boolean }) {
  const qr = entry.qr;
  const make = (source: "direct" | "po") => `/procurement/supplier-bills/new?source=${source}&inbox=${entry.id}${source === "direct" && entry.supplierId ? `&supplierId=${entry.supplierId}` : ""}`;
  return (
    <li className="flex flex-col gap-2 p-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="flex flex-wrap items-center gap-2">
          <a className="inline-flex items-center gap-1 font-medium text-brand hover:underline" href={billInboxFileUrl(entry.id, true)} target="_blank" rel="noreferrer">
            <FileText className="size-4" aria-hidden="true" />{entry.fileName}</a>
          {entry.status === "billed" && <StatusBadge tone="success">{`Bill ${entry.billNumber ?? ""}`}</StatusBadge>}
          {entry.status === "set_aside" && <StatusBadge tone="neutral">Not a bill</StatusBadge>}
          {qr && <StatusBadge tone="info">e-invoice QR read</StatusBadge>}
        </span>
        <span className="text-text-secondary break-words">From {entry.fromName ? `${entry.fromName} · ` : ""}{entry.fromEmail ?? "unknown sender"} · {dateTime(entry.receivedAt)}{entry.subject ? ` · ${entry.subject}` : ""}</span>
        <span>{entry.supplierName ? <>Supplier: <Link className="text-brand hover:underline" href={`/procurement/suppliers/${entry.supplierId}`}>{entry.supplierName}</Link></> : <span className="text-warning">Supplier not recognised</span>}
          {qr ? ` · Invoice ${qr.invoiceNumber ?? "—"} of ${qr.invoiceDate ? calendarDate(qr.invoiceDate) : "—"} · ${qr.total ? money("INR", qr.total) : "—"}` : ""}</span>
        {entry.status === "new" && entry.problems.map((problem) => <span key={problem} className="text-xs text-warning">{problem}</span>)}
        {entry.status === "set_aside" && entry.setAsideReason && <span className="text-xs text-text-muted">{entry.setAsideReason}</span>}
      </div>
      <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
        {entry.status === "new" && canCreate && <>
          <LinkButton size="compact" variant="primary" href={make("po")}>Make bill from a PO</LinkButton>
          <LinkButton size="compact" variant="secondary" href={make("direct")}>Make direct bill</LinkButton>
          <Button size="compact" variant="ghost" onPress={onSetAside}>Not a bill</Button>
        </>}
        {entry.status === "set_aside" && canCreate && <Button size="compact" variant="ghost" isLoading={restoring} onPress={onRestore}>Bring back</Button>}
        {entry.status === "billed" && entry.billId && <LinkButton size="compact" variant="secondary" href={`/procurement/supplier-bills/${entry.billId}`}>Open bill</LinkButton>}
      </div>
    </li>
  );
}

function SetAsideDialog({ entry, onClose, onDone }: { entry: BillInboxEntry; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => setAsideBillInbox(entry.id, { reason: reason.trim() }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Not a bill · ${entry.fileName}`} description="It moves to Not bills; you can bring it back." size="md">
      <div className="flex flex-col gap-3">
        {save.error && <Notice>{errorMessage(save.error)}</Notice>}
        <TextArea label="Why" isRequired value={reason} onChange={setReason} rows={2} placeholder="Statement of account" />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!reason.trim()} isLoading={save.isPending} onPress={() => save.mutate()}>Set aside</Button>
        </div>
      </div>
    </Dialog>
  );
}
