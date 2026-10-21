import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New Item" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)inventory/items/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/items/new", "inventory/items", await params, await searchParams);
}
