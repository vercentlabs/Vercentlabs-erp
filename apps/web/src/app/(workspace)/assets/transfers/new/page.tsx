import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New transfer" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)assets/transfers/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("assets/transfers/new", "assets/transfers", await params, await searchParams);
}
