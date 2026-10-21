import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit customer" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)sales/customers/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("sales/customers/[id]/edit", "sales/customers/[id]", await params, await searchParams);
}
