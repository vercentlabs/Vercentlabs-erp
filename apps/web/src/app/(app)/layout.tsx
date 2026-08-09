import AppShell from "@/components/app-shell";
import { requireWorkspace } from "@/lib/auth";
import { resolveNavigation } from "@/lib/navigation/resolve-navigation";
import { getShellData } from "@/lib/platform";
import { resolveQuickCreate } from "@/lib/quick-create/resolve-quick-create";

export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireWorkspace();
  const [shellData, navigation, quickCreate] = await Promise.all([
    getShellData(session),
    resolveNavigation(session),
    resolveQuickCreate(session),
  ]);
  return (
    <AppShell
      session={session}
      shellData={shellData}
      navigation={navigation}
      quickCreate={quickCreate}
    >
      {children}
    </AppShell>
  );
}
