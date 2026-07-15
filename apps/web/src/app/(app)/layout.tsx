import AppShell from "@/components/app-shell";
import { requireWorkspace } from "@/lib/auth";
import { getShellData } from "@/lib/platform";

export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireWorkspace();
  const shellData = await getShellData(session);
  return (
    <AppShell session={session} shellData={shellData}>
      {children}
    </AppShell>
  );
}
