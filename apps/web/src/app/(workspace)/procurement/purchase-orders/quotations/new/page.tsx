import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New supplier quotation" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/purchase-orders/quotations/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/purchase-orders/quotations/new", "procurement/purchase-orders/quotations", await params, await searchParams);
}
