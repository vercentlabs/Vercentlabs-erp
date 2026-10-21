import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New Stock Adjustment" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)inventory/adjustments/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/adjustments/new", "inventory/adjustments", await params, await searchParams);
}
