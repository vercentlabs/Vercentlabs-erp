"use client";

// The "Put on hold" / "Add a reason" dialog for the order's action dialogs: reason, severity, the explanation and what it is linked to.
// Placing a hold on an order already held adds the reason to the hold in force.
import type { Ask } from "@/features/manufacturing/orders/components/MoDialogs";

import { REASON_OPTIONS, SEVERITY_OPTIONS, placeHold } from "../api/hold-api";

export function holdAsk(orderId: string, { adding = false, onDone }: { adding?: boolean; onDone: (result: { holdId: string }) => Promise<void> | void }): Ask {
  return {
    title: adding ? "Add a reason to the hold" : "Put the order on hold", confirm: adding ? "Add reason" : "Put on hold", tone: "danger",
    description: adding ? "The hold keeps its start; production resumes only when every reason is cleared by its own authority."
      : "New issues, consumption, batches and output stop at once. What was already issued, produced, accepted, received and posted stays as it is; reservations are kept.",
    fields: [
      { name: "reasonCode", label: "Reason", kind: "select", required: true, initial: "MATERIAL_SHORTAGE", options: REASON_OPTIONS },
      { name: "severity", label: "Severity", kind: "select", required: true, initial: "NORMAL", options: SEVERITY_OPTIONS,
        description: "Quality failures are cleared by Quality; safety concerns and anything critical by the safety authority." },
      { name: "description", label: "Explain why production must stop", kind: "textarea", required: true },
      { name: "sourceReference", label: "Reference (shortage, incident, ticket)", kind: "text" },
    ],
    run: async (values, requestKey) => {
      const result = await placeHold(orderId, { reasonCode: values.reasonCode, severity: values.severity, description: String(values.description).trim(),
        sourceReference: String(values.sourceReference ?? "").trim() || null, idempotencyKey: requestKey });
      await onDone(result);
    },
  };
}
