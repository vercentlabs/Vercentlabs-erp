import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New store / outlet" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)pos/outlets/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("pos/outlets/new", "pos/outlets", await params, await searchParams);
}
