import "server-only";

import { getSupplierPayment, paymentAdviceAuto, renderAuthorizedDocument, sendPaymentAdvice } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type Client = Parameters<typeof getSupplierPayment>[0];

// After payments are recorded: each posted one's advice is emailed to the supplier when Setup says so. A failure never undoes a payment;
// it is kept on the payment as not sent. Returns { paymentId: "sent" | reason }.
export async function sendAdviceForPayments(client: Client, session: WorkspaceSessionContext, context: Parameters<typeof getSupplierPayment>[1], paymentIds: string[]) {
  const outcome: Record<string, string> = {};
  if (!paymentIds.length || !(await paymentAdviceAuto(client, context.organizationId))) return outcome;
  for (const id of paymentIds) {
    await client.query("SAVEPOINT payment_advice");
    try {
      const detail = await getSupplierPayment(client, context, id);
      if (!["posted", "partially_applied", "applied"].includes(String(detail.payment.status))) { await client.query("RELEASE SAVEPOINT payment_advice"); continue; }
      const pdf = await renderAuthorizedDocument(client, session, "procurement.payment_advice", id);
      const sent = await sendPaymentAdvice(client, context, detail, { auto: true }, { fileName: pdf.fileName, content: pdf.body });
      outcome[id] = sent.sent ? "sent" : sent.reason ?? "not sent";
      await client.query("RELEASE SAVEPOINT payment_advice");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT payment_advice");
      outcome[id] = error instanceof Error ? error.message : "not sent";
    }
  }
  return outcome;
}
