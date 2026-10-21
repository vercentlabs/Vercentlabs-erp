import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit supplier bill" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)procurement/supplier-bills/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/supplier-bills/[id]/edit", "procurement/supplier-bills/[id]", await params, await searchParams);
}
