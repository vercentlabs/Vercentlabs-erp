import { requireWorkspace } from "@/core/session";
import { CrmQuoteScreen } from "@/features/crm/quotes/CrmQuoteScreen";

export const metadata = { title: "Quote" };

export default async function Page({ params }: { params: Promise<{ quoteId: string }> }) {
  await requireWorkspace();
  const { quoteId } = await params;
  return <CrmQuoteScreen quoteId={quoteId} />;
}
