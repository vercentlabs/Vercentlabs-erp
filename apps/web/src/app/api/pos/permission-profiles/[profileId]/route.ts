import { z } from "zod";

import { deletePermissionProfile, getPermissionProfile, updatePermissionProfile } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ profileId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { profileId } = await params;
  return posRead(request, async (client, context) => ({ profile: await getPermissionProfile(client, context, profileId) }), "pos.permission_profiles.view");
}

// name, description, code (Draft only), grants: [{ code, enabled, limitMode, maxPercentage, maxAmount, requireReason }], expectedVersion.
export async function PATCH(request: Request, { params }: Params) {
  const { profileId } = await params;
  return posMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ profile: await updatePermissionProfile(client, context, profileId, input) }),
    200, "pos.permission_profiles.view");
}

// Only a profile never activated or assigned.
export async function DELETE(request: Request, { params }: Params) {
  const { profileId } = await params;
  return posMutation(request, z.record(z.string(), z.unknown()), (client, context) => deletePermissionProfile(client, context, profileId), 200, "pos.permission_profiles.view");
}
