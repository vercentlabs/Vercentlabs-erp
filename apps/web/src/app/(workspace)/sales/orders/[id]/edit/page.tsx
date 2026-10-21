import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit sales order" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)sales/orders/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("sales/orders/[id]/edit", "sales/orders/[id]", await params, await searchParams);
}
