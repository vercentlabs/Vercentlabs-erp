import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New category" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/settings/categories/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/settings/categories/new", "procurement/settings/categories", await params, await searchParams);
}
