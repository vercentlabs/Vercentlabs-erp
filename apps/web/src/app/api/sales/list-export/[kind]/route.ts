import { exportSalesList } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";

// Export on the Sales lists without an export of their own (CRM parity): the list as filtered on screen, or only the ticked rows
// (?ids=). Each needs the right to print that document, as an order export needs the right to print orders.
const PERMISSION = {
  invoices: "sales.invoice.print", "credit-notes": "sales.credit_note.print", deliveries: "sales.delivery.print", returns: "sales.return.print",
  payments: "sales.invoice.payments.view",
} as const;
type Kind = keyof typeof PERMISSION;

export async function GET(request: Request, route: { params: Promise<{ kind: string }> }) {
  const { kind } = await route.params;
  if (!(kind in PERMISSION)) return Response.json({ ok: false, message: "This list cannot be exported." }, { status: 404 });
  const filters = Object.fromEntries(new URL(request.url).searchParams.entries());
  return workspaceRoute(request, { module: "sales", permission: PERMISSION[kind as Kind] }, async ({ client, session }) => {
    const exported = await exportSalesList(client, salesContext(session), kind as Kind, filters);
    return new Response(exported.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${exported.fileName}"`,
      "cache-control": "no-store" } });
  });
}
