import { z } from "zod";

import { setInvoiceExportDetails } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => ({
    details: (await client.query(
      `SELECT sales.shipping_bill_number AS "shippingBillNumber", sales.shipping_bill_date::text AS "shippingBillDate", sales.port_code AS "portCode", invoice.supply_type AS "supplyType"
         FROM tenant.sales_invoices sales JOIN tenant.accounting_customer_invoices invoice ON invoice.id = sales.customer_invoice_id
        WHERE sales.organization_id = $1 AND sales.customer_invoice_id = $2`, [context.organizationId, id])).rows[0] ?? null,
  }));
}

// The export invoice's shipping bill and port code (Sales report Phase 3); also after it is final.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", z.object({ shippingBillNumber: z.string().max(20).nullable().optional(), shippingBillDate: z.string().max(10).nullable().optional(),
    portCode: z.string().max(6).nullable().optional() }), async (client, context, input) => setInvoiceExportDetails(client, context, id, input));
}
