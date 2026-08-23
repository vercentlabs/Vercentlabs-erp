import { getSessionContext } from "@/core/auth";
import { getBillingSummary } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { query } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.billingView);
    const [summary, payments, invoices, profileRows] = await Promise.all([
      getBillingSummary(session.organizationId),
      query(
        `SELECT provider_payment_id, amount_paise, currency, status, method, captured_at, created_at
         FROM billing_payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [session.organizationId],
      ),
      query(
        `SELECT provider_invoice_id, amount_paise, amount_due_paise, amount_paid_paise, currency, status, invoice_url, issued_at, paid_at
         FROM billing_invoices WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [session.organizationId],
      ),
      query(
        `SELECT legal_name, billing_email, phone, gstin, billing_address
         FROM billing_customers WHERE organization_id = $1 LIMIT 1`,
        [session.organizationId],
      ),
    ]);
    return ok({ summary, payments, invoices, profile: profileRows[0] || null });
  } catch (error) {
    return errorResponse(error);
  }
}
