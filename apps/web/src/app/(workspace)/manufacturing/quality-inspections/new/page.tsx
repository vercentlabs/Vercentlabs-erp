import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Start an inspection" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)manufacturing/quality-inspections/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/quality-inspections/new", "manufacturing/quality-inspections", await params, await searchParams);
}
