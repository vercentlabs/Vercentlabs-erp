import { z } from "zod";

import { assignPermissionProfile, getCashierEffectivePermissionSummary } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ cashierId: string }> };

// The cashier's permission profile, who assigned it when, and what it lets them do (limits only for profile administrators).
export async function GET(request: Request, { params }: Params) {
  const { cashierId } = await params;
  return posRead(request, async (client, context) => ({ permissions: await getCashierEffectivePermissionSummary(client, context, cashierId) }), "pos.cashiers.view");
}

// body: { profileId } — an active profile of the company (null removes it).
export async function PUT(request: Request, { params }: Params) {
  const { cashierId } = await params;
  return posMutation(request, z.object({ profileId: z.string().uuid().nullable() }), async (client, context, input) => {
    await assignPermissionProfile(client, context, cashierId, input.profileId);
    return { permissions: await getCashierEffectivePermissionSummary(client, context, cashierId) };
  }, 200, "pos.cashiers.view");
}
