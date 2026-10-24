import { z } from "zod";
import { renderAuthorizedDocument, runRecurringSchedules } from "@vercentlabs/api";

export const JOB_TYPE = "sales.automation.recurring";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Sales (Sales report Phase 3): once a day, the company's recurring orders and invoices that are due. The run log has one row per
// schedule and date, so a re-run or an overlapping tick makes nothing twice. The IRN of a recurring invoice is made from the invoice's page.
export async function recurringHandler(client, systemContext) {
  return runRecurringSchedules(client, { organizationId: systemContext.organizationId }, {
    renderPdf: async (context, invoiceId) => {
      const pdf = await renderAuthorizedDocument(client, context, "sales.invoice", invoiceId);
      return { fileName: pdf.fileName, content: pdf.body };
    },
  });
}
