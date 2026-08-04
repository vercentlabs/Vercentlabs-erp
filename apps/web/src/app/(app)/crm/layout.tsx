import CrmSectionTabs from "@/components/crm-section-tabs";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CrmSectionTabs />
      {children}
    </>
  );
}
