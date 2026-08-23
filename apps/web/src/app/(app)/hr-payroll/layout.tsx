import ModulePageGuard from "@/core/components/module-page-guard";

export default function HrPayrollLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="hr-payroll">{children}</ModulePageGuard>;
}
