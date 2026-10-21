import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New Product or Service" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)sales/products/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("sales/products/new", "sales/products", await params, await searchParams);
}
