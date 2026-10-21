import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit Stock Count" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)inventory/stock-counts/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/stock-counts/[id]/edit", "inventory/stock-counts/[id]", await params, await searchParams);
}
