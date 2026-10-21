import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New supplier bill" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/supplier-bills/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/supplier-bills/new", "procurement/supplier-bills", await params, await searchParams);
}
