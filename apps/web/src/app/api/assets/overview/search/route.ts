import { searchAssets } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET ?q= — authorized assets by code, name, tag, serial, legacy code, invoice or transfer number. Searching never changes anything.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return assetsRead(request, async (client, context) => ({ rows: await searchAssets(client, context, { q }) }));
}
