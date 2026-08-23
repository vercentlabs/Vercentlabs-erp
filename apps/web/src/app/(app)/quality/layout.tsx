import ModulePageGuard from "@/core/components/module-page-guard";

export default function QualityLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="quality">{children}</ModulePageGuard>;
}
