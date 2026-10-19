import { deleteTdsCertificate, listTdsCertificates, saveTdsCertificate } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// The supplier's lower-deduction certificates (section 197): a lower TDS rate for a section, for dates and an amount.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return procurementRead(request, async (client, ctx) => ({ certificates: await listTdsCertificates(client, ctx, id) }), "procurement.bills.view");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return procurementMutation(request, bodySchema, async (client, ctx, input) => ({ certificate: await saveTdsCertificate(client, ctx, { ...input, supplierId: id }) }), 201, "tax.rates.manage");
}

// ?certificateId=
export async function DELETE(request: Request) {
  const certificateId = new URL(request.url).searchParams.get("certificateId") ?? "";
  return procurementMutation(request, bodySchema, async (client, ctx) => deleteTdsCertificate(client, ctx, certificateId), 200, "tax.rates.manage");
}
