import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit supplier" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)procurement/suppliers/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/suppliers/[id]/edit", "procurement/suppliers/[id]", await params, await searchParams);
}
