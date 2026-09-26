import { z } from "zod";

import { archiveBusinessDataRecord, getBusinessDataRecord, updateBusinessDataRecord } from "@vercentlabs/api";

import { assertPartyDuplicatePolicy, assertReadable, assertWritable, CUSTOMER_TYPES, recordPartyDuplicateOverride, shapeCustomerInput } from "@/features/sales/master/server/master-resources";
import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";
import { HttpError } from "@/core/http";

const IDENTITY_FIELDS = ["displayName", "legalName", "gstin", "pan"];

export async function GET(request: Request, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => {
    assertReadable(resource);
    const record = (await getBusinessDataRecord(client, context, resource, id)) as Record<string, unknown>;
    if (resource === "parties" && !CUSTOMER_TYPES.includes(String(record.partyType))) {
      throw new HttpError(404, "Customer not found.");
    }
    // Item rows carry cost (standard cost, purchase price). Cost is margin
    // information: without sales.margin.view it is removed here, server-side
    // -- same rule the list route already enforces.
    const canSeeCost = context.roleSlugs.includes("organization_owner") || context.permissions.includes("sales.margin.view");
    if (resource === "items" && !canSeeCost) {
      const safe = { ...record };
      delete safe.standardCost;
      delete safe.purchasePrice;
      return { record: safe };
    }
    return { record };
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params;
  return salesMutation(request, "parties.manage", z.record(z.string(), z.unknown()), async (client, context, input) => {
    assertWritable(resource);
    const { expectedUpdatedAt, duplicateOverrideReason, ...rest } = input as Record<string, unknown>;
    const shaped = shapeCustomerInput(resource, rest, false);
    const touchesIdentity = resource === "parties" && Object.keys(shaped).some((field) => IDENTITY_FIELDS.includes(field));
    const duplicateOverride = touchesIdentity ? await assertPartyDuplicatePolicy(client, context, shaped, duplicateOverrideReason, id) : null;
    const record = await updateBusinessDataRecord(
      client,
      context,
      resource,
      id,
      shaped,
      typeof expectedUpdatedAt === "string" && expectedUpdatedAt ? { expectedUpdatedAt } : {},
    );
    if (duplicateOverride) {
      await recordPartyDuplicateOverride(client, context, id, duplicateOverride.matchedPartyIds, "update", duplicateOverride.reason);
    }
    return { record };
  });
}

// "Delete" archives (sets the record inactive); history that references it stays intact.
export async function DELETE(request: Request, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params;
  const expectedUpdatedAt = new URL(request.url).searchParams.get("expectedUpdatedAt") || undefined;
  return salesMutation(request, "parties.manage", emptySchema, async (client, context) => {
    assertWritable(resource);
    return { record: await archiveBusinessDataRecord(client, context, resource, id, expectedUpdatedAt ? { expectedUpdatedAt } : {}) };
  });
}
