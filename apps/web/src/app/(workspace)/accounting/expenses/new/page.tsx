import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Record expense" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)accounting/expenses/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("accounting/expenses/new", "accounting/expenses", await params, await searchParams);
}
