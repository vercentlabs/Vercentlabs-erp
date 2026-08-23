import ModulePageGuard from "@/core/components/module-page-guard";

export default function ManufacturingLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="manufacturing">{children}</ModulePageGuard>;
}
