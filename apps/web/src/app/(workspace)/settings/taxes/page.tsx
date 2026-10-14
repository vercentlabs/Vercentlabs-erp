import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { TaxesScreen } from "@/features/settings/taxes/screens/TaxesScreen";
import { taxTabOf } from "@/features/settings/taxes/tabs";

export const metadata = { title: "Taxes" };

// Settings › Taxes: one tab per screen (?tab=categories | registrations | defaults | check | history), so a tab survives refresh and sharing.
export default async function TaxesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireWorkspace();
  const { tab } = await searchParams;
  return <TaxesScreen canView={hasSessionPermission(session, "tax.view")} tab={taxTabOf(tab)} />;
}
