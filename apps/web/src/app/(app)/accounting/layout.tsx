import ModulePageGuard from "@/core/components/module-page-guard";

export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="accounting">{children}</ModulePageGuard>;
}
