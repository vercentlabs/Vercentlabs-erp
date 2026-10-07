import { z } from "zod";

import { setItemProfileStatus } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ profileId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { profileId } = await params;
  return accountingMutation(request, z.object({ status: z.enum(["active", "inactive"]) }), async (client, context, input) =>
    ({ profile: await setItemProfileStatus(client, context, profileId, input.status) }), 200, "accounting.settings.manage");
}
