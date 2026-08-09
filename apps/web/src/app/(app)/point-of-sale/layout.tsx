import ModulePageGuard from "@/components/module-page-guard";

export default function PointOfSaleLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="point-of-sale">{children}</ModulePageGuard>;
}
