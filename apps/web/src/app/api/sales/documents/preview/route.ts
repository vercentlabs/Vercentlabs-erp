import { previewSalesDocument } from "@vercentlabs/api";

import { projectDocumentPreview } from "@/features/sales/shared/preview-projection";
import { salesMutation } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

// A preview never persists anything, so it needs only the read permission a
// user already has to see prices; creating/revising is what needs create.
export async function POST(request: Request) {
  return salesMutation(
    request,
    "sales.view",
    documentSchema,
    async (client, context, input) => {
      // A line without a price is shown as a warning here; saving refuses it.
      // Discount limit and reason problems are reported too, so the totals stay visible while the user types.
      const preview = await previewSalesDocument(client, context, input, { allowMissingPrice: true, preview: true });
      return { preview: projectDocumentPreview(preview, context) };
    },
  );
}
