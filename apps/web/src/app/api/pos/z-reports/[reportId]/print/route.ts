import { z } from "zod";

import { recordZReportPrint } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ reportId: string }> };

// POST: print or reprint the Z report — recorded; the content is the frozen snapshot.
const schema = z.object({ format: z.enum(["THERMAL", "A4"]).optional(), reason: z.string().trim().max(300).optional() });

export async function POST(request: Request, { params }: Params) {
  const { reportId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ report: await recordZReportPrint(client, context, reportId, input) }), 201, "pos.view");
}
