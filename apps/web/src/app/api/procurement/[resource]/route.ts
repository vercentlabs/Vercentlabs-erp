import { z } from "zod";

import { createProcurementRecord, listProcurementRecords } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";

// One list/create endpoint for every Procurement resource. The resource key is
// validated by the domain (configFor -> 404), which also applies that resource's
// own view/create permission, company scoping and sensitive-field redaction.
export async function GET(request: Request, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  const url = new URL(request.url);
  const filters = {
    status: url.searchParams.get("status") || undefined,
    search: url.searchParams.get("search") || undefined,
    parentId: url.searchParams.get("parentId") || undefined,
    limit: url.searchParams.get("limit") || undefined,
    offset: url.searchParams.get("offset") || undefined,
  };
  return procurementRead(request, async (client, context) => listProcurementRecords(client, context, resource, filters));
}

export async function POST(request: Request, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  return procurementMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ record: await createProcurementRecord(client, context, resource, input) }), 201);
}
