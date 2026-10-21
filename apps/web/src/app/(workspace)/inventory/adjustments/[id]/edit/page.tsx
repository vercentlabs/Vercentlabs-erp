import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit Stock Adjustment" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)inventory/adjustments/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/adjustments/[id]/edit", "inventory/adjustments/[id]", await params, await searchParams);
}
