import { z } from "zod";

import { setEInvoiceApplicability } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ registrationId: string }> };

// PUT: whether this GST registration is under the e-invoice mandate (from the company's turnover and current notifications). No IRP is
// connected, so a B2B bill needing an IRN is then blocked at POS and issued through the company's e-invoicing workflow instead.
const schema = z.object({ applicable: z.boolean(), applicableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });

export async function PUT(request: Request, { params }: Params) {
  const { registrationId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ registration: await setEInvoiceApplicability(client, context, registrationId, input) }), 200, "pos.settings.manage");
}
