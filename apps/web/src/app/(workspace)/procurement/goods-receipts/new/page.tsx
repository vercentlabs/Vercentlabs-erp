import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Create goods receipt" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/goods-receipts/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/goods-receipts/new", "procurement/goods-receipts", await params, await searchParams);
}
