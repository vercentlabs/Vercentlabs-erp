import { ModuleFoundationPage } from "@/shell/module-foundation/ModuleFoundationPage";

export const metadata = { title: "CRM" };

export default function CrmPage() {
  return (
    <ModuleFoundationPage
      moduleKey="crm"
      moduleLabel="CRM"
      nextPromptNote="CRM's real screens (leads, accounts, opportunities) are built in the next rebuild prompt."
    />
  );
}
