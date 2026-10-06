import { addSupplierContact, listSupplierContacts } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

// The people at the supplier. Filters: search (name, email, phone, designation, location), role, locationId, status.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const filters = Object.fromEntries(["search","role","locationId","status"].map((key) => [key, url.searchParams.get(key)]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => ({ contacts: await listSupplierContacts(client, context, id, filters) }));
}

// Body: contactId (link an existing person) or a new person, roles, locationId, defaults (contact purposes).
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => await addSupplierContact(client, context, id, input), 201);
}
