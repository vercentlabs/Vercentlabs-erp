"use client";

// A payment's receipt vouchers (Sales report Phase 2): GST on an advance received before the supply (Rule 50), issued here; its use on
// invoices; and a refund voucher (Rule 51) when the advance is given back. Shown once receipt vouchers are switched on.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, NumberField, Select, StatusBadge, TextArea, TextField, buttonVariants } from "@vercentlabs/design-system";

import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { post, request } from "@/features/sales/shared/http";
import { calendarDate, money } from "@/features/sales/shared/format";

type Voucher = {
  id: string; number: string; date: string; rate: number; amount: number; taxable: number; igst: number; cgst: number; sgst: number; supplyNature: "intra" | "inter";
  used: number; refunded: number; left: number; status: string; description: string | null;
  uses: Array<{ invoiceId: string; invoiceNumber: string; date: string; amount: number }>; refunds: Array<{ id: string; number: string; date: string; amount: number; reason: string }>;
};
const STATUS = { issued: "Not used yet", partly_used: "Partly used", used: "Used", refunded: "Refunded", cancelled: "Cancelled" } as Record<string, string>;
const RATES = [0, 5, 12, 18, 28, 40].map((rate) => ({ value: String(rate), label: `${rate}%` }));
const pdf = (kind: string, id: string) => `/api/documents/${kind}/${id}/pdf?disposition=inline`;

export function ReceiptVouchersPanel({ receiptId, unapplied }: { receiptId: string; unapplied: number }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "receipt-vouchers", receiptId),
    queryFn: () => request<{ vouchers: Voucher[]; vouchersFrom: string | null }>(`/payments/${receiptId}/receipt-vouchers`), retry: false });
  const [issuing, setIssuing] = useState(false);
  const [refunding, setRefunding] = useState<Voucher | null>(null);
  const data = query.data;
  if (!data || (!data.vouchersFrom && !data.vouchers.length)) return null;
  const open = data.vouchers.reduce((total, voucher) => total + voucher.left, 0);
  const canIssue = unapplied - open > 0.005;
  return (
    <Panel title="Receipt vouchers (GST on advance)" description="GST on an advance for a supply not yet invoiced. It is adjusted when the advance is used."
      actions={canIssue ? <Button size="compact" variant="secondary" onPress={() => setIssuing(true)}>Issue receipt voucher</Button> : undefined}>
      {data.vouchers.length === 0 ? <p className="text-sm text-text-secondary">No receipt voucher yet.</p> : (
        <LinesTable columns={["Voucher", "Date", "Rate", { label: "Amount", numeric: true }, { label: "Tax", numeric: true }, "Status", ""]}>
          {data.vouchers.map((voucher) => (
            <tr key={voucher.id}>
              <Cell><a className="text-brand hover:underline" href={pdf("sales.receipt_voucher", voucher.id)} target="_blank" rel="noreferrer">{voucher.number}</a></Cell>
              <Cell>{calendarDate(voucher.date)}</Cell>
              <Cell>{`${voucher.rate}%`}</Cell>
              <Cell numeric>{money("INR", voucher.amount)}</Cell>
              <Cell numeric>{money("INR", voucher.igst + voucher.cgst + voucher.sgst)}</Cell>
              <Cell>
                <span className="flex flex-col gap-0.5">
                  <StatusBadge tone={voucher.left > 0.005 ? "info" : "neutral"}>{STATUS[voucher.status] ?? voucher.status}</StatusBadge>
                  {voucher.uses.map((use) => <span key={`${use.invoiceId}-${use.date}`} className="text-xs text-text-muted">{`${money("INR", use.amount)} on ${use.invoiceNumber}`}</span>)}
                  {voucher.refunds.map((refund) => (
                    <a key={refund.id} className="text-xs text-brand hover:underline" href={pdf("sales.refund_voucher", refund.id)} target="_blank" rel="noreferrer">
                      {`${refund.number}: ${money("INR", refund.amount)} refunded`}
                    </a>
                  ))}
                </span>
              </Cell>
              <Cell>
                <MoreMenu label={`Actions for ${voucher.number}`} items={[
                  { id: "pdf", label: "View voucher", onAction: () => window.open(pdf("sales.receipt_voucher", voucher.id), "_blank", "noopener") },
                  ...(voucher.left > 0.005 ? [{ id: "refund", label: "Refund voucher", onAction: () => setRefunding(voucher) }] : []),
                ]} />
              </Cell>
            </tr>
          ))}
        </LinesTable>
      )}
      {issuing && <IssueDialog receiptId={receiptId} available={Math.round((unapplied - open) * 100) / 100} onClose={() => setIssuing(false)} onDone={() => { setIssuing(false); void query.refetch(); }} />}
      {refunding && <RefundDialog voucher={refunding} onClose={() => setRefunding(null)} onDone={() => { setRefunding(null); void query.refetch(); }} />}
    </Panel>
  );
}

function IssueDialog({ receiptId, available, onClose, onDone }: { receiptId: string; available: number; onClose: () => void; onDone: () => void }) {
  const [rate, setRate] = useState("18");
  const [amount, setAmount] = useState(available);
  const [description, setDescription] = useState("");
  const [sac, setSac] = useState("");
  const save = useMutation({
    mutationFn: () => post(`/payments/${receiptId}/receipt-vouchers`, { rate: Number(rate), amount, description: description.trim() || undefined, sacHsn: sac.trim() || undefined }),
    onSuccess: onDone,
  });
  const tax = Math.round((amount - (amount * 100) / (100 + Number(rate))) * 100) / 100;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Issue receipt voucher" description="Use the GST rate of what you will supply. The tax is included in the amount.">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberField label="Advance" value={amount} onChange={(value) => setAmount(Number.isFinite(value) ? value : 0)} minValue={0.01} maxValue={available} step={0.01}
            description={`Up to ${money("INR", available)}.`} />
          <Select label="GST rate" selectedKey={rate} onSelectionChange={(key) => setRate(String(key))} options={RATES} description={`Tax inside: ${money("INR", tax)}.`} />
          <TextField label="For" value={description} onChange={setDescription} placeholder="For example: Course fee, batch of June" />
          <TextField label="SAC / HSN" value={sac} onChange={setSac} />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!(amount > 0)}>Issue voucher</Button>
        </div>
      </form>
    </Dialog>
  );
}

function RefundDialog({ voucher, onClose, onDone }: { voucher: Voucher; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(voucher.left);
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => post(`/receipt-vouchers/${voucher.id}/refund`, { amount, reason: reason.trim() }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Refund voucher for ${voucher.number}`}
      description="The GST document for an advance given back. Pay the money back from Refunds.">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <NumberField label="Amount returned" value={amount} onChange={(value) => setAmount(Number.isFinite(value) ? value : 0)} minValue={0.01} maxValue={voucher.left} step={0.01}
          description={`Up to ${money("INR", voucher.left)}.`} />
        <TextArea label="Why" isRequired value={reason} onChange={setReason} placeholder="For example: course cancelled" />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Link className={`${buttonVariants({ variant: "ghost" })} w-full sm:w-auto`} href="/sales/refunds">Open Refunds</Link>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!(amount > 0) || reason.trim().length < 3}>Issue refund voucher</Button>
        </div>
      </form>
    </Dialog>
  );
}
