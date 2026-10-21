import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New quotation" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)sales/quotations/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("sales/quotations/new", "sales/quotations", await params, await searchParams);
}
