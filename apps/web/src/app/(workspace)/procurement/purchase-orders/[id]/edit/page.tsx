import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit purchase order" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)procurement/purchase-orders/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/purchase-orders/[id]/edit", "procurement/purchase-orders/[id]", await params, await searchParams);
}
