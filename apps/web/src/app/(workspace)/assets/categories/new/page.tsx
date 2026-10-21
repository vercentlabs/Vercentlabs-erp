import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New asset category" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)assets/categories/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("assets/categories/new", "assets/categories", await params, await searchParams);
}
