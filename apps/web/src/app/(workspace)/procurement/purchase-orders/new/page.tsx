import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New purchase order" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/purchase-orders/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/purchase-orders/new", "procurement/purchase-orders", await params, await searchParams);
}
