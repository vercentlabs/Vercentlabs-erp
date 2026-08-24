import ModulePageGuard from "@/core/components/module-page-guard";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModulePageGuard moduleId="crm">
      <div className="crm-standard-shell crm-workbench crm-hci-shell">{children}</div>
    </ModulePageGuard>
  );
}
