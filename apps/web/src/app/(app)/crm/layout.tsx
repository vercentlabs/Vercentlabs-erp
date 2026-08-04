import CrmSectionTabs from "@/components/crm-section-tabs";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="crm-standard-shell crm-workbench">
      <CrmSectionTabs />
      {children}
    </div>
  );
}
