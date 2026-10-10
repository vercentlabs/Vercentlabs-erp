import { z } from "zod";

import { clonePermissionProfile } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ profileId: string }> };

// body: { code?, name? } — a Draft copy with the same grants and limits.
export async function POST(request: Request, { params }: Params) {
  const { profileId } = await params;
  return posMutation(request, z.object({ code: z.string().optional(), name: z.string().optional() }),
    async (client, context, input) => ({ profile: await clonePermissionProfile(client, context, profileId, input) }), 201, "pos.permission_profiles.view");
}
