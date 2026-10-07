import { z } from "zod";

import { getItemProfile, updateItemProfile } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ profileId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { profileId } = await params;
  return accountingRead(request, async (client, context) => ({ profile: await getItemProfile(client, context, profileId) }));
}

// Items using the profile post to the new accounts from now on; posted journals are not touched.
export async function PATCH(request: Request, { params }: Params) {
  const { profileId } = await params;
  return accountingMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ profile: await updateItemProfile(client, context, profileId, input) }), 200,
    "accounting.settings.manage");
}
