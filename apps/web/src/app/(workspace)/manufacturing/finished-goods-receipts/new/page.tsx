import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Receive finished goods" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)manufacturing/finished-goods-receipts/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/finished-goods-receipts/new", "manufacturing/finished-goods-receipts", await params, await searchParams);
}
