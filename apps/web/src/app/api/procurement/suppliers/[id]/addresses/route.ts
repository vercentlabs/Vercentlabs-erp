import { addSupplierAddress, listSupplierAddresses } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

// The supplier's locations. Filters: purpose, city, stateCode, countryCode, registrationId, status, search.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const filters = Object.fromEntries(["purpose","city","stateCode","countryCode","registrationId","status","search"].map((key) => [key, url.searchParams.get(key)]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => ({ addresses: await listSupplierAddresses(client, context, id, filters) }));
}

// Body: label, purposes, the address, taxRegistrationId or gstin, locationEmail, locationPhone, defaults (purposes it becomes the default for).
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => await addSupplierAddress(client, context, id, input), 201);
}
