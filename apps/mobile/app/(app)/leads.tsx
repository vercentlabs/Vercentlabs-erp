import { CrmListScreen } from "@/ui/crm-list-screen";
import { LeadCapture } from "@/features/leads/lead-capture";

export default function LeadsScreen() {
  return <CrmListScreen resource="leads" eyebrow="Prospecting" title="Leads" titleKeys={["fullName", "companyName", "email"]} subtitleKeys={["companyName", "email", "mobile"]} icon="person-outline" headerAction={<LeadCapture />} />;
}
