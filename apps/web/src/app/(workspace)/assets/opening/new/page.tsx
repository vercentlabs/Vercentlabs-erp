import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Add an existing asset" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)assets/opening/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("assets/opening/new", "assets/opening", await params, await searchParams);
}
