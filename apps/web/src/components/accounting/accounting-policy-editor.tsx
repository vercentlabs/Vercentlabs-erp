"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  companyId: string;
  settings: Record<string, unknown> | null;
};

export default function AccountingPolicyEditor({ companyId, settings }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    setMessage("");
    const payload = {
      companyId,
      journalApprovalThreshold: String(formData.get("journalApprovalThreshold") || "0"),
      customerInvoiceApprovalRequired: formData.get("customerInvoiceApprovalRequired") === "on",
      customerInvoiceApprovalThreshold: String(formData.get("customerInvoiceApprovalThreshold") || "0"),
      vendorBillApprovalRequired: formData.get("vendorBillApprovalRequired") === "on",
      vendorBillApprovalThreshold: String(formData.get("vendorBillApprovalThreshold") || "0"),
      vendorPaymentApprovalRequired: formData.get("vendorPaymentApprovalRequired") === "on",
      vendorPaymentApprovalThreshold: String(formData.get("vendorPaymentApprovalThreshold") || "0"),
      autoPostSalesInvoices: formData.get("autoPostSalesInvoices") === "on",
      autoPostVendorBills: formData.get("autoPostVendorBills") === "on",
      hardCloseRequiresAllTasks: formData.get("hardCloseRequiresAllTasks") === "on",
    };
    try {
      const response = await fetch("/api/accounting/settings", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Accounting policy update failed.");
      setMessage("Accounting policy updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Accounting policy update failed.");
    } finally {
      setPending(false);
    }
  }

  return <form className="panel accounting-form" action={submit}>
    <div><p className="eyebrow">Approval and automation policy</p><h2>Financial control thresholds</h2><p>Bind document approvals to value thresholds and preserve separation of duties before posting.</p></div>
    <div className="accounting-form-grid">
      <label>Journal approval threshold<input name="journalApprovalThreshold" type="number" step="0.000001" min="0" defaultValue={String(settings?.journal_approval_threshold ?? 0)} /></label>
      <label>Customer invoice threshold<input name="customerInvoiceApprovalThreshold" type="number" step="0.000001" min="0" defaultValue={String(settings?.customer_invoice_approval_threshold ?? 0)} /></label>
      <label>Vendor bill threshold<input name="vendorBillApprovalThreshold" type="number" step="0.000001" min="0" defaultValue={String(settings?.vendor_bill_approval_threshold ?? 0)} /></label>
      <label>Vendor payment threshold<input name="vendorPaymentApprovalThreshold" type="number" step="0.000001" min="0" defaultValue={String(settings?.vendor_payment_approval_threshold ?? 0)} /></label>
      <label>Customer invoice approval<input name="customerInvoiceApprovalRequired" type="checkbox" defaultChecked={Boolean(settings?.customer_invoice_approval_required)} /></label>
      <label>Vendor bill approval<input name="vendorBillApprovalRequired" type="checkbox" defaultChecked={Boolean(settings?.vendor_bill_approval_required)} /></label>
      <label>Vendor payment approval<input name="vendorPaymentApprovalRequired" type="checkbox" defaultChecked={Boolean(settings?.vendor_payment_approval_required)} /></label>
      <label>Auto-post Sales invoices<input name="autoPostSalesInvoices" type="checkbox" defaultChecked={Boolean(settings?.auto_post_sales_invoices)} /></label>
      <label>Auto-post vendor bills<input name="autoPostVendorBills" type="checkbox" defaultChecked={Boolean(settings?.auto_post_vendor_bills)} /></label>
      <label>Strict hard-close checklist<input name="hardCloseRequiresAllTasks" type="checkbox" defaultChecked={Boolean(settings?.hard_close_requires_all_tasks)} /></label>
    </div>
    <div className="accounting-form-actions"><button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save policy"}</button>{message ? <span>{message}</span> : null}</div>
  </form>;
}
