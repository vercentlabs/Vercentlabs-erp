import { z } from "zod";

import { setPermissionProfileStatus, validatePermissionProfile } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ profileId: string }> };

// What would stop the profile being activated ([] when valid).
export async function GET(request: Request, { params }: Params) {
  const { profileId } = await params;
  return posRead(request, async (client, context) => ({ issues: await validatePermissionProfile(client, context, profileId) }), "pos.permission_profiles.view");
}

// body: { status: active | inactive }
export async function POST(request: Request, { params }: Params) {
  const { profileId } = await params;
  return posMutation(request, z.object({ status: z.string() }), async (client, context, input) => ({ profile: await setPermissionProfileStatus(client, context, profileId, input.status) }),
    200, "pos.permission_profiles.view");
}
