import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New sales order" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)sales/orders/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("sales/orders/new", "sales/orders", await params, await searchParams);
}
