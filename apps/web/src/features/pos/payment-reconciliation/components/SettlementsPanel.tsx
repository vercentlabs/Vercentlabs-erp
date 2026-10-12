"use client";

// Provider settlements: upload a settlement report (CSV / XLSX) for a merchant account, review the gross-to-net preview and errors, commit it
// once; open a payout to see its lines, their matches and exceptions, suggest and apply a manual match (reason and evidence; material ones wait
// for another person's approval), approve or reverse matches, match bank receipts and post the payout to Finance after its bank receipt.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import {
  approveMatch, commitImport, manualMatch, matchBank, merchantAccounts, postToFinance, previewImport, reverseMatch, settlementDetail, settlements, suggest,
  type ImportPreview, type SettlementLine, type Suggestion,
} from "@/features/pos/payment-reconciliation/api/reconciliation-api";
import { PosApiError } from "@/features/pos/shared/http";
import { money } from "@/features/pos/shared/format";
import { PosAlert, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

export function SettlementsPanel() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const listKey = scopedQueryKey(workspace, "payment-reconciliation", "settlements");
  const list = useQuery({ queryKey: listKey, queryFn: () => settlements({}), retry: false });
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "payment-reconciliation", "merchants"), queryFn: merchantAccounts, retry: false });
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await work(); } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PosPanel title="Import a settlement report" description="Vercentlabs standard settlement template (settlement_id, settlement_date, payout_reference, line_type, transaction_id, reference, currency, gross_amount, fee_amount, fee_tax_amount…). Nothing is recorded until you commit.">
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Merchant account" size="compact" selectedKey={merchantId} placeholder="Choose" onSelectionChange={(value) => setMerchantId(value ? String(value) : null)}
            options={(accounts.data?.merchantAccounts ?? []).map((account) => ({ value: account.id, label: account.displayName }))} />
          <label className="text-sm">
            <span className="mb-1 block text-xs text-text-muted">File (.csv or .xlsx)</span>
            <input type="file" accept=".csv,.xlsx" disabled={!merchantId || busy} className="text-sm"
              onChange={(changeEvent) => { const file = changeEvent.target.files?.[0]; if (file && merchantId) void run(async () => setPreview(await previewImport({ merchantAccountId: merchantId, fileName: file.name, contentBase64: await toBase64(file) }))); changeEvent.target.value = ""; }} />
          </label>
        </div>
        {preview && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3 text-sm">
            <p>{preview.fileName} · {preview.lines} lines · {preview.errorCount} errors</p>
            {preview.errors.map((item) => <p key={`${item.row}-${item.message}`} className="text-danger">Row {item.row}: {item.message}</p>)}
            {preview.batches.map((batch) => (
              <p key={batch.settlementId}>{batch.settlementId} ({batch.settlementDate}) · gross {batch.gross} − refunds {batch.refunds} − fees {batch.fees} − tax on fees {batch.feeTax} − chargebacks {batch.chargebacks}
                {" "}± adjustments {batch.adjustments} = <strong>{batch.calculatedNet}</strong>{batch.reportedNet ? ` · reported ${batch.reportedNet}${batch.netDifference !== "0.00" ? ` (difference ${batch.netDifference})` : ""}` : ""}
                {batch.duplicateLines ? ` · ${batch.duplicateLines} line(s) already imported will be skipped` : ""}</p>
            ))}
            <div className="flex gap-2">
              <Button size="compact" variant="primary" isLoading={busy} isDisabled={preview.errorCount > 0 || preview.status !== "PREVIEW"}
                onPress={() => run(async () => { const result = await commitImport(preview.id); setPreview(null); setMessage(`Committed ${result.batches.length} settlement(s).`); await queryClient.invalidateQueries({ queryKey: listKey }); })}>Commit</Button>
              <Button size="compact" variant="ghost" onPress={() => setPreview(null)}>Discard</Button>
            </div>
          </div>
        )}
      </PosPanel>
      <div className="flex gap-2">
        <Button size="compact" variant="secondary" isLoading={busy} onPress={() => run(async () => { const result = await matchBank(); setMessage(`${result.matched} bank receipt(s) matched.`); await queryClient.invalidateQueries({ queryKey: listKey }); })}>Match bank receipts</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Settlement</th><th className="pb-1 text-left">Date</th><th className="pb-1 text-right">Gross</th><th className="pb-1 text-right">Fees</th>
            <th className="pb-1 text-right">Net</th><th className="pb-1 text-right">In bank</th><th className="pb-1 text-left">Status</th><th className="pb-1 text-left">Finance</th></tr></thead>
          <tbody>{(list.data ?? []).map((row) => (
            <tr key={row.id} className={`cursor-pointer border-t border-border ${selected === row.id ? "bg-surface-muted" : ""}`} onClick={() => setSelected(row.id)}>
              <td className="py-1.5 font-medium">{row.settlementId}<span className="block text-xs text-text-muted">{row.merchant}</span></td><td>{String(row.settlementDate).slice(0, 10)}</td>
              <td className="text-right tabular-nums">{money(row.currency, row.gross)}</td><td className="text-right tabular-nums">{money(row.currency, Number(row.fees) + Number(row.feeTax))}</td>
              <td className="text-right tabular-nums">{money(row.currency, row.calculatedNet)}</td><td className="text-right tabular-nums">{money(row.currency, row.bankMatched)}</td>
              <td><StatusBadge tone={row.status === "BANK_MATCHED" ? "success" : row.status === "MISMATCHED" ? "danger" : "warning"}>{row.status.toLowerCase().replace(/_/g, " ")}</StatusBadge></td>
              <td>{row.financeStatus.toLowerCase()}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {selected && <SettlementDetailPanel id={selected} onChanged={() => queryClient.invalidateQueries({ queryKey: listKey })} />}
      {message && <PosAlert tone="success">{message}</PosAlert>}
      {error && <PosAlert>{error}</PosAlert>}
    </div>
  );
}

function SettlementDetailPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "payment-reconciliation", "settlement", id);
  const query = useQuery({ queryKey: key, queryFn: () => settlementDetail(id), retry: false });
  const [line, setLine] = useState<SettlementLine | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [form, setForm] = useState({ internalId: "", amount: "", reason: "", evidence: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const data = query.data;
  if (!data) return null;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); await queryClient.invalidateQueries({ queryKey: key }); onChanged(); } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  };
  return (
    <PosPanel title={`Settlement ${data.settlementId}`} description={`${data.merchant} · payout ${data.payoutReference ?? "—"} · ${data.status.toLowerCase().replace(/_/g, " ")} · Finance ${data.financeStatus.toLowerCase()}${data.financeError ? ` (${data.financeError})` : ""}`}>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-xs text-text-muted"><tr><th className="text-left">#</th><th className="text-left">Type</th><th className="text-left">Transaction</th><th className="text-right">Gross</th><th className="text-right">Fees</th><th className="text-left">Status</th><th /></tr></thead>
        <tbody>{data.lines.map((row) => (
          <tr key={row.id} className="border-t border-border"><td className="py-1">{row.number}</td><td>{row.type.toLowerCase()}</td><td className="break-all">{row.transactionId ?? row.reference ?? "—"}</td>
            <td className="text-right tabular-nums">{row.gross}</td><td className="text-right tabular-nums">{Number(row.fee ?? 0) + Number(row.feeTax ?? 0)}</td>
            <td>{row.status.toLowerCase().replace(/_/g, " ")}{row.matches.map((match) => (
              <span key={match.id} className="ml-1 inline-flex gap-1">
                {match.status === "PENDING_APPROVAL" && <Button size="compact" variant="ghost" isLoading={busy} onPress={() => run(() => approveMatch(match.id))}>Approve</Button>}
                <Button size="compact" variant="ghost" isLoading={busy} onPress={() => { const reason = window.prompt("Why is this match wrong?"); if (reason) void run(() => reverseMatch(match.id, reason)); }}>Reverse</Button>
              </span>
            ))}</td>
            <td>{row.status === "UNMATCHED" && <Button size="compact" variant="ghost" onPress={() => { setLine(row); setForm({ internalId: "", amount: String(row.gross ?? ""), reason: "", evidence: "" });
              void suggest("payment_settlement_line", row.id).then(setSuggestions).catch(() => setSuggestions([])); }}>Match…</Button>}</td></tr>
        ))}</tbody>
      </table></div>
      {line && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3 text-sm">
          <p className="font-medium">Match line {line.number} ({line.gross}) manually</p>
          {suggestions.length ? <ul>{suggestions.map((item) => (
            <li key={item.internalId}><button type="button" className="text-brand hover:underline" onClick={() => setForm({ ...form, internalId: item.internalId })}>{item.reference ?? item.internalId}</button> · {item.amount} · {item.rule.toLowerCase().replace(/_/g, " ")}</li>
          ))}</ul> : <p className="text-text-muted">No candidates found — amount and date alone are only ever suggestions.</p>}
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="Payment ID" size="compact" value={form.internalId} onChange={(value) => setForm({ ...form, internalId: value })} />
            <TextField label="Amount" size="compact" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} className="sm:max-w-[8rem]" />
            <TextField label="Reason" size="compact" value={form.reason} onChange={(value) => setForm({ ...form, reason: value })} maxLength={500} />
            <TextField label="Evidence reference" size="compact" value={form.evidence} onChange={(value) => setForm({ ...form, evidence: value })} maxLength={200} />
            <Button size="compact" variant="primary" isLoading={busy} isDisabled={!form.internalId || !form.reason.trim() || !form.evidence.trim()}
              onPress={() => run(async () => { await manualMatch({ internalType: line.type === "REFUND" ? "payment_refund_component" : "pos_payment", internalId: form.internalId.trim(), externalType: "payment_settlement_line",
                externalId: line.id, amount: form.amount.trim(), reason: form.reason.trim(), evidence: [{ kind: "document", reference: form.evidence.trim() }], idempotencyKey: crypto.randomUUID() }); setLine(null); })}>Apply match</Button>
          </div>
        </div>
      )}
      {data.bankMatches.length > 0 && <ul className="text-sm">{data.bankMatches.map((match) => <li key={match.id}>Bank {match.bankReference} · {String(match.bankDate).slice(0, 10)} · {match.amount} · {match.rule.toLowerCase()} · {match.status.toLowerCase()}</li>)}</ul>}
      {data.status === "BANK_MATCHED" && data.financeStatus !== "POSTED" && (
        <div><Button size="compact" variant="secondary" isLoading={busy} onPress={() => run(() => postToFinance(id))}>Post to Finance</Button></div>
      )}
      {error && <PosAlert>{error}</PosAlert>}
    </PosPanel>
  );
}
