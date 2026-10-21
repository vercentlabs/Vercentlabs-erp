import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Add an asset" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)assets/register/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("assets/register/new", "assets/register", await params, await searchParams);
}
