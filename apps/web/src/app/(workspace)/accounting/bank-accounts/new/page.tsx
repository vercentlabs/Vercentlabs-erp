import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New bank or cash account" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)accounting/bank-accounts/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("accounting/bank-accounts/new", "accounting/bank-accounts", await params, await searchParams);
}
