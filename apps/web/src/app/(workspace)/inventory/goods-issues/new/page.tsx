import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New Goods Issue" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)inventory/goods-issues/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/goods-issues/new", "inventory/goods-issues", await params, await searchParams);
}
