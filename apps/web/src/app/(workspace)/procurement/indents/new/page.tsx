import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New purchase indent" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/indents/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/indents/new", "procurement/indents", await params, await searchParams);
}
