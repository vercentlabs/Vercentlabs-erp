import AppShell from "@/core/components/app-shell";
import { requireWorkspace } from "@/core/auth";
import { resolveNavigation } from "@/core/navigation/resolve-navigation";
import { getShellData } from "@/core/platform";
import { resolveQuickCreate } from "@/core/quick-create/resolve-quick-create";

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
