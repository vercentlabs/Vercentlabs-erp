import { createQuotationTemplate, listQuotationTemplates } from "@vercentlabs/api";

import { quotationTemplateSchema } from "@/features/sales/quotations/template-schema";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Quotation templates (Sales report Phase 2): the active ones for New quotation; ?includeInactive=1 for Setup. Created by whoever manages
// Sales settings (checked by the operation too).
export async function GET(request: Request) {
  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "1";
  return salesRead(request, "sales.view", async (client, context) => listQuotationTemplates(client, context, { includeInactive }));
}

export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", quotationTemplateSchema.extend({ name: quotationTemplateSchema.shape.name.unwrap() }),
    async (client, context, input) => createQuotationTemplate(client, context, input), 201);
}
