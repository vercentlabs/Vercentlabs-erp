import { PublicQuoteScreen } from "@/features/sales/quotations/screens/PublicQuoteScreen";

export const metadata = { title: "Your quotation" };

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col bg-canvas px-4 py-10">
      <PublicQuoteScreen token={token} />
    </div>
  );
}
