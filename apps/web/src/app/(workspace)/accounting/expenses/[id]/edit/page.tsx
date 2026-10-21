import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit expense" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)accounting/expenses/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("accounting/expenses/[id]/edit", "accounting/expenses/[id]", await params, await searchParams);
}
