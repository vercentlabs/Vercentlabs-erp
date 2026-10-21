import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New purchase return" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/purchase-returns/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/purchase-returns/new", "procurement/purchase-returns", await params, await searchParams);
}
