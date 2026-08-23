import ModulePageGuard from "@/core/components/module-page-guard";

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="sales">{children}</ModulePageGuard>;
}
