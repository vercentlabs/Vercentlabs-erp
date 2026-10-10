import { getCashierPermissionCatalogue, permissionProfileCapabilities } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// The server-defined permission catalogue (codes, areas, which limits each takes) and what the caller may do with profiles.
export async function GET(request: Request) {
  return posRead(request, async (_client, context) => ({ ...getCashierPermissionCatalogue(), capabilities: permissionProfileCapabilities(context) }),
    "pos.permission_profiles.view");
}
