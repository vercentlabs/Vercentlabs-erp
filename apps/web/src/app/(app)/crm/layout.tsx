import CrmSectionTabs from "@/components/crm-section-tabs";
import ModulePageGuard from "@/components/module-page-guard";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModulePageGuard moduleId="crm">
      <div className="crm-standard-shell crm-workbench">
        <CrmSectionTabs />
        {children}
      </div>
    </ModulePageGuard>
  );
}
