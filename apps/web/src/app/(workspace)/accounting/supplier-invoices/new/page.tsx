import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New bill" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)accounting/supplier-invoices/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("accounting/supplier-invoices/new", "accounting/supplier-invoices", await params, await searchParams);
}
