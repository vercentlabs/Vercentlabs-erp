import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit supplier rate" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/supplier-rates/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/supplier-rates/[id]/edit", "procurement/supplier-rates", await params, await searchParams);
}
