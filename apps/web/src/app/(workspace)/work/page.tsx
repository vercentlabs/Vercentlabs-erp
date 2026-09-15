import { PlatformFoundationPage } from "@/shell/module-foundation/PlatformFoundationPage";

export const metadata = { title: "Work" };

export default function WorkPage() {
  return (
    <PlatformFoundationPage
      label="Work"
      description="A global view of your tasks, approvals, follow-ups and exceptions across modules — aggregated once each module exposes assigned-work data through a real API."
    />
  );
}
