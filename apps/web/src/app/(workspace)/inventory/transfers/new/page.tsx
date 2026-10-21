import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New Transfer" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)inventory/transfers/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/transfers/new", "inventory/transfers", await params, await searchParams);
}
