import { requireWorkspace } from "@/core/session";
import { ConvertLeadScreen } from "@/features/crm/conversion/screens/ConvertLeadScreen";

export const metadata = { title: "Convert lead" };

export default async function ConvertLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  await requireWorkspace();
  return <ConvertLeadScreen leadId={(await params).leadId} />;
}
