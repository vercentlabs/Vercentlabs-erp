import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit Product" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)sales/products/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("sales/products/[id]/edit", "sales/products/[id]", await params, await searchParams);
}
