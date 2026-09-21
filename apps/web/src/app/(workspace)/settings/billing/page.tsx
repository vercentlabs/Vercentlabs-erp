import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { BillingScreen } from "@/features/billing/screens/BillingScreen";

export const metadata = { title: "Billing" };

export default async function BillingSettingsPage() {
  const session = await requireWorkspace();
  return <BillingScreen canManage={hasSessionPermission(session, "billing.manage")} canCheckout={hasSessionPermission(session, "billing.checkout")} />;
}
