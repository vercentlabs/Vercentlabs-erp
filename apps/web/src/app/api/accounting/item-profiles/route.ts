import { z } from "zod";

import { createItemProfile, listItemProfiles } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// Finance's item profiles; ?kind=inventory|accounting narrows the list.
export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  return accountingRead(request, async (client, context) => ({ profiles: await listItemProfiles(client, context, { kind: kind || null }) }));
}

export async function POST(request: Request) {
  return accountingMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ profile: await createItemProfile(client, context, input) }), 201,
    "accounting.settings.manage");
}
