import ModulePageGuard from "@/core/components/module-page-guard";

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="support">{children}</ModulePageGuard>;
}
