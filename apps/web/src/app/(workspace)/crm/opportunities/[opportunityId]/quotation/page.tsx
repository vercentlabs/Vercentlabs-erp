import { requireWorkspace } from "@/core/session";
import { CreateQuotationScreen } from "@/features/crm/quotations/screens/CreateQuotationScreen";

export const metadata = { title: "Create quotation" };

export default async function CreateQuotationPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  await requireWorkspace();
  return <CreateQuotationScreen opportunityId={(await params).opportunityId} />;
}
