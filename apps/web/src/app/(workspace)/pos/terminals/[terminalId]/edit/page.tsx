import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Set up POS terminal" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)pos/terminals/[terminalId]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("pos/terminals/[terminalId]/edit", "pos/terminals/[terminalId]", await params, await searchParams);
}
