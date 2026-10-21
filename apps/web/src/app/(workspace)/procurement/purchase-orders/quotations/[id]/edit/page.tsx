import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit supplier quotation" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)procurement/purchase-orders/quotations/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/purchase-orders/quotations/[id]/edit", "procurement/purchase-orders/quotations/[id]", await params, await searchParams);
}
