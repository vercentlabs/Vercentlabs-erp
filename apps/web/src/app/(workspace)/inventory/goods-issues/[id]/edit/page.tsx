import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit Goods Issue" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)inventory/goods-issues/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/goods-issues/[id]/edit", "inventory/goods-issues/[id]", await params, await searchParams);
}
