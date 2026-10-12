import { z } from "zod";

import { scanMissingPostings } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

// Finds documents that reached their posting point without an accounting entry.
export async function POST(request: Request) {
  return accountingMutation(request, z.object({}).passthrough(), async (client, context) => ({ result: await scanMissingPostings(client, context) }), 200, "accounting.journal.post");
}
