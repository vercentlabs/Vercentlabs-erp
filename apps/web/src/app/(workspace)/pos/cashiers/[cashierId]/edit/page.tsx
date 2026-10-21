import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit cashier" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)pos/cashiers/[cashierId]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("pos/cashiers/[cashierId]/edit", "pos/cashiers/[cashierId]", await params, await searchParams);
}
