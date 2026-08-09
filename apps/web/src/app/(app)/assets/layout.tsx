import ModulePageGuard from "@/components/module-page-guard";

export default function AssetsLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="assets">{children}</ModulePageGuard>;
}
