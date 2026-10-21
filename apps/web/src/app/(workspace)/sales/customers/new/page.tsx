import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New customer" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)sales/customers/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("sales/customers/new", "sales/customers", await params, await searchParams);
}
