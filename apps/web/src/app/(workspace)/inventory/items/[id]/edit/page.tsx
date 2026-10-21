import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit Item" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)inventory/items/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/items/[id]/edit", "inventory/items/[id]", await params, await searchParams);
}
