"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Option = {
  id: string;
  code?: string;
  name?: string;
  display_name?: string;
  party_type?: string;
  currency_code?: string;
  ledger_id?: string;
  account_class?: string;
  is_group?: boolean;
};

type Line = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxAmount: string;
  accountId: string;
  taxAccountId: string;
};

const newLine = (): Line => ({
  key: crypto.randomUUID(),
  description: "",
  quantity: "1",
  unitPrice: "",
  discountAmount: "0",
  taxAmount: "0",
  accountId: "",
  taxAccountId: "",
});

const numeric = (value: string) => Number(value || 0);

function requestLines(lines: Line[]) {
  return lines.map((row) => ({
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    discountAmount: row.discountAmount,
    taxAmount: row.taxAmount,
    accountId: row.accountId || null,
    taxAccountId: row.taxAccountId || null,
  }));
}

export default function SubledgerDocumentEditor({
  kind,
  companyId,
  baseCurrency,
  parties,
  ledgers,
  accounts,
}: {
  kind: "receivable" | "payable";
  companyId: string;
  baseCurrency: string;
  parties: Option[];
  ledgers: Option[];
  accounts: Option[];
}) {
  const router = useRouter();
  const [partyId, setPartyId] = useState("");
  const [documentType, setDocumentType] = useState(kind === "receivable" ? "invoice" : "bill");
  const [ledgerId, setLedgerId] = useState(ledgers[0]?.id || "");
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [vendorNumber, setVendorNumber] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const total = useMemo(
    () => lines.reduce(
      (sum, row) => sum
        + numeric(row.quantity) * numeric(row.unitPrice)
        - numeric(row.discountAmount)
        + numeric(row.taxAmount),
      0,
    ),
    [lines],
  );

  const eligibleParties = parties.filter((row) => (
    kind === "receivable"
      ? ["customer", "both"].includes(String(row.party_type))
      : ["supplier", "both"].includes(String(row.party_type))
  ));

  const eligibleAccounts = accounts.filter((row) => (
    !row.is_group
    && (!row.ledger_id || row.ledger_id === ledgerId)
    && (kind === "receivable" ? row.account_class === "revenue" : row.account_class === "expense")
  ));

  function patch(key: string, field: keyof Line, value: string) {
    setLines((current) => current.map((row) => (
      row.key === key ? { ...row, [field]: value } : row
    )));
  }

  async function save() {
    setError("");
    if (!partyId || !ledgerId || lines.some((row) => !row.description || numeric(row.unitPrice) <= 0)) {
      setError("Select a party and complete every line.");
      return;
    }
    if (kind === "payable" && !vendorNumber) {
      setError("Enter the vendor invoice number.");
      return;
    }

    setPending(true);
    try {
      const endpoint = kind === "receivable"
        ? "/api/accounting/receivables/invoices"
        : "/api/accounting/payables/bills";
      const common = {
        companyId,
        ledgerId,
        partyId,
        accountingDate: documentDate,
        dueDate: dueDate || null,
        currencyCode: baseCurrency,
        lines: requestLines(lines),
      };
      const body = kind === "receivable"
        ? { ...common, invoiceType: documentType, invoiceDate: documentDate }
        : {
            ...common,
            billType: documentType,
            billDate: documentDate,
            supplierInvoiceDate: documentDate,
            supplierInvoiceNumber: vendorNumber,
          };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as {
        ok?: boolean;
        message?: string;
        invoice?: { invoice?: { id?: string } };
        bill?: { bill?: { id?: string } };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Document could not be created.");
      }
      const id = kind === "receivable"
        ? payload.invoice?.invoice?.id
        : payload.bill?.bill?.id;
      router.push(`/accounting/${kind === "receivable" ? "receivables" : "payables"}/${String(id || "")}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Document could not be created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="accounting-editor">
      <section className="panel">
        <p className="eyebrow">{kind === "receivable" ? "Customer invoice" : "Vendor bill"}</p>
        <h2>Document details</h2>
        <div className="accounting-form-grid">
          <label>
            {kind === "receivable" ? "Customer" : "Vendor"}
            <select value={partyId} onChange={(event) => setPartyId(event.target.value)}>
              <option value="">Select party</option>
              {eligibleParties.map((row) => (
                <option key={row.id} value={row.id}>{row.code} · {row.display_name || row.name}</option>
              ))}
            </select>
          </label>
          <label>
            Document type
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
              {kind === "receivable" ? (
                <>
                  <option value="invoice">Customer invoice</option>
                  <option value="credit_note">Customer credit note</option>
                  <option value="debit_note">Customer debit note</option>
                  <option value="opening">Opening receivable</option>
                </>
              ) : (
                <>
                  <option value="bill">Vendor bill</option>
                  <option value="credit_note">Vendor credit note</option>
                  <option value="debit_note">Vendor debit note</option>
                  <option value="opening">Opening payable</option>
                </>
              )}
            </select>
          </label>
          <label>
            Ledger
            <select value={ledgerId} onChange={(event) => setLedgerId(event.target.value)}>
              {ledgers.map((row) => (
                <option key={row.id} value={row.id}>{row.code} · {row.name}</option>
              ))}
            </select>
          </label>
          <label>
            Document date
            <input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} />
          </label>
          <label>
            Due date
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          {kind === "payable" ? (
            <label>
              Vendor invoice number
              <input value={vendorNumber} onChange={(event) => setVendorNumber(event.target.value)} />
            </label>
          ) : null}
          <label>
            Currency
            <input value={baseCurrency} disabled />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="accounting-section-heading">
          <div>
            <p className="eyebrow">Line items</p>
            <h2>Commercial accounting lines</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => setLines((current) => [...current, newLine()])}>
            Add line
          </button>
        </div>
        <div className="accounting-invoice-grid accounting-line-head">
          <span>Description</span><span>Account</span><span>Quantity</span><span>Unit price</span>
          <span>Discount</span><span>Tax</span><span>Total</span><span />
        </div>
        {lines.map((row) => (
          <div className="accounting-invoice-grid" key={row.key}>
            <input value={row.description} onChange={(event) => patch(row.key, "description", event.target.value)} />
            <select value={row.accountId} onChange={(event) => patch(row.key, "accountId", event.target.value)}>
              <option value="">Use default mapping</option>
              {eligibleAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.code} · {account.name}</option>
              ))}
            </select>
            <input inputMode="decimal" value={row.quantity} onChange={(event) => patch(row.key, "quantity", event.target.value)} />
            <input inputMode="decimal" value={row.unitPrice} onChange={(event) => patch(row.key, "unitPrice", event.target.value)} />
            <input inputMode="decimal" value={row.discountAmount} onChange={(event) => patch(row.key, "discountAmount", event.target.value)} />
            <input inputMode="decimal" value={row.taxAmount} onChange={(event) => patch(row.key, "taxAmount", event.target.value)} />
            <strong>
              {baseCurrency} {(numeric(row.quantity) * numeric(row.unitPrice) - numeric(row.discountAmount) + numeric(row.taxAmount)).toFixed(2)}
            </strong>
            <button
              className="icon-button"
              type="button"
              disabled={lines.length === 1}
              onClick={() => setLines((current) => current.filter((item) => item.key !== row.key))}
            >
              ×
            </button>
          </div>
        ))}
        <div className="accounting-document-total">
          <span>Document total</span>
          <strong>{baseCurrency} {total.toFixed(2)}</strong>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="accounting-editor-actions">
          <button className="primary-button" type="button" disabled={pending} onClick={save}>
            {pending ? "Saving…" : documentType === "credit_note"
              ? kind === "receivable" ? "Create customer credit note" : "Create vendor credit note"
              : kind === "receivable" ? "Create customer invoice" : "Create vendor bill"}
          </button>
        </div>
      </section>
    </div>
  );
}
