import ModulePageGuard from "@/components/module-page-guard";

export default function StockLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="stock">{children}</ModulePageGuard>;
}
