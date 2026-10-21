import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New invoice" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)accounting/customer-invoices/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("accounting/customer-invoices/new", "accounting/customer-invoices", await params, await searchParams);
}
