import type { Metadata } from "next";

import BillingWorkspace from "@/core/components/billing-workspace";
import {
  hasPermission,
  PERMISSIONS,
  requirePermission,
} from "@/core/authorization";
import { getBillingSummary, listBillingPlans } from "@/core/billing";
import { query } from "@/core/db";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await requirePermission(PERMISSIONS.billingView);
  const organizationId = session.organizationId as string;
  const [plans, summary, payments, invoices, profileRows] = await Promise.all([
    listBillingPlans(),
    getBillingSummary(organizationId),
    query(
      `SELECT provider_payment_id, amount_paise, currency, status, method, captured_at, created_at
       FROM billing_payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [organizationId],
    ),
    query(
      `SELECT provider_invoice_id, amount_paise, amount_due_paise, amount_paid_paise, currency, status, invoice_url, issued_at, paid_at
       FROM billing_invoices WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [organizationId],
    ),
    query(
      `SELECT legal_name, billing_email, phone, gstin, billing_address
       FROM billing_customers WHERE organization_id = $1 LIMIT 1`,
      [organizationId],
    ),
  ]);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Subscription and commercial control</p>
          <h1>Billing</h1>
          <p>
            Pay for business capacity and service scope—not each employee who
            needs to use the ERP.
          </p>
        </div>
        <span className="status-badge">
          <AppIconShim /> Razorpay-ready
        </span>
      </section>
      <BillingWorkspace
        plans={plans}
        summary={summary}
        payments={JSON.parse(JSON.stringify(payments))}
        invoices={JSON.parse(JSON.stringify(invoices))}
        profile={JSON.parse(JSON.stringify(profileRows[0] || null))}
        canManage={hasPermission(session, PERMISSIONS.billingManage)}
        canCheckout={hasPermission(session, PERMISSIONS.billingCheckout)}
      />
    </>
  );
}

function AppIconShim() {
  return <span aria-hidden="true">₹</span>;
}
