import { getPermissionProfileAuditHistory } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ profileId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { profileId } = await params;
  return posRead(request, async (client, context) => ({ rows: await getPermissionProfileAuditHistory(client, context, profileId) }), "pos.permission_profiles.view");
}
