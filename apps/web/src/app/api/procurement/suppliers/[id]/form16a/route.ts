import { form16AData } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Form 16A details for the supplier and a quarter (?fy=2026&quarter=3): what was credited, the TDS and the challans it went under.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  const q = new URL(request.url).searchParams;
  return procurementRead(request, async (client, context) => {
    const party = (await client.query(`SELECT party_id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [context.organizationId, id])).rows[0];
    const finance = { ...context, permissions: [...new Set([...(context.permissions ?? []), "accounting.view"])] };
    return { form16a: party ? await form16AData(client, finance, { partyId: party.party_id, fy: q.get("fy") ?? "", quarter: q.get("quarter") ?? "" }) : null };
  }, "procurement.bills.view");
}
