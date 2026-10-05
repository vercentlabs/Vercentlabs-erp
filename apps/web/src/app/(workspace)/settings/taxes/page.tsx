import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { TaxesScreen } from "@/features/settings/taxes/screens/TaxesScreen";

export const metadata = { title: "Taxes" };

export default async function TaxesPage() {
  const session = await requireWorkspace();
  return <TaxesScreen canView={hasSessionPermission(session, "tax.view")} />;
}
