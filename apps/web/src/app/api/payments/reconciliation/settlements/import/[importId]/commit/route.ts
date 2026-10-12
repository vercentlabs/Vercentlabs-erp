import { z } from "zod";

import { commitSettlementImport } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ importId: string }> };

// POST: commit a previewed settlement report (once; a repeat returns the same result).
const schema = z.object({});

export async function POST(request: Request, { params }: Params) {
  const { importId } = await params;
  return posMutation(request, schema, async (client, context) => ({ result: await commitSettlementImport(client, context, importId) }), 200, "pos.view");
}
