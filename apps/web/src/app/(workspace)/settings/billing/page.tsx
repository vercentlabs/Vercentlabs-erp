import { hasSessionPermission } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { BillingScreen } from "@/features/billing/screens/BillingScreen";

export const metadata = { title: "Billing" };

// Exact abilities (UX only; every action is re-checked on the server).
export default async function BillingSettingsPage() {
  const session = await requireWorkspace();
  return (
    <BillingScreen
      abilities={{
        canView: hasSessionPermission(session, BILLING_PERMISSIONS.view),
        canManage: hasSessionPermission(session, BILLING_PERMISSIONS.manage),
        canCheckout: hasSessionPermission(session, BILLING_PERMISSIONS.checkout),
        canAudit: hasSessionPermission(session, BILLING_PERMISSIONS.audit),
      }}
    />
  );
}
