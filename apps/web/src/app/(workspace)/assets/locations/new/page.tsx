import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New asset location" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)assets/locations/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("assets/locations/new", "assets/locations", await params, await searchParams);
}
