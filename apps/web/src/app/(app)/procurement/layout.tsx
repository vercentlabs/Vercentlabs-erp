import ModulePageGuard from "@/core/components/module-page-guard";

export default function ProcurementLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="procurement">{children}</ModulePageGuard>;
}
