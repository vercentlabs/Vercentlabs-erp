import ModulePageGuard from "@/core/components/module-page-guard";
import { CrmCommandDialogProvider } from "@/modules/crm/ui/crm-command-dialog-provider";

/* CRM feature styles are route-owned rather than loaded for every ERP module. */
import "../../crm-shell.css";
import "../../crm-home.css";
import "../../crm-lead-create-workspace.css";
import "../../crm-lead-workspaces.css";
import "../../crm-experience.css";
import "../../crm-accounts.css";
import "../../crm-contacts.css";
import "../../crm-lead-sources.css";
import "../../crm-lead-lifecycle.css";
import "../../crm-sales-stages.css";
import "../../crm-calls.css";
import "../../crm-meetings.css";
import "@/modules/crm/ui/crm-ui-system.css";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModulePageGuard moduleId="crm">
      <CrmCommandDialogProvider>
        <div className="crm-ui-root crm-standard-shell crm-workbench crm-hci-shell" data-crm-ui="canonical">
          {children}
        </div>
      </CrmCommandDialogProvider>
    </ModulePageGuard>
  );
}
