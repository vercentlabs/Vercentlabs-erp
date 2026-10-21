import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit purchase return" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)procurement/purchase-returns/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/purchase-returns/[id]/edit", "procurement/purchase-returns/[id]", await params, await searchParams);
}
