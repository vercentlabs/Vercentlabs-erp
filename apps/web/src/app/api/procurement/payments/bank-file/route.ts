import { bankFileFor } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

// The bank payment file for supplier payments (?ids=a,b,c): a CSV for the bank's bulk payments. Problems (a supplier without a bank
// account) come back in the X-Bank-File-Problems header, as JSON.
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
  return workspaceRoute(request, { module: "procurement", permission: "procurement.view", billingWrite: true }, async ({ client, session }) => {
    const file = await bankFileFor(client as never, procurementContext(session), { paymentIds: ids });
    return new Response(file.content, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "private, no-store", "X-Bank-File-Problems": encodeURIComponent(JSON.stringify(file.problems)) } });
  });
}
