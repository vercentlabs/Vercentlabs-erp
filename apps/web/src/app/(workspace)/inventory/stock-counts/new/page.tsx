import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New Stock Count" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)inventory/stock-counts/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/stock-counts/new", "inventory/stock-counts", await params, await searchParams);
}
