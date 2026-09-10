import ModulePageGuard from "@/core/components/module-page-guard";
import { CrmCommandDialogProvider } from "@/modules/crm/ui/crm-command-dialog-provider";
import { CrmRouteExperience } from "@/modules/crm/ui/crm-route-experience";

/* One canonical CRM stylesheet; feature CSS Modules remain component-owned. */
import "@/modules/crm/ui/crm.css";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModulePageGuard moduleId="crm">
      <CrmCommandDialogProvider>
        <div className="crm-ui-root crm-standard-shell crm-workbench crm-hci-shell" data-crm-ui="canonical">
          <CrmRouteExperience>{children}</CrmRouteExperience>
        </div>
      </CrmCommandDialogProvider>
    </ModulePageGuard>
  );
}
