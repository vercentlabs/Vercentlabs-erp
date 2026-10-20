import { redirect } from "next/navigation";

// The ticket queues live on the Support workspace.
export default function SupportTicketsPage() {
  redirect("/support?view=open");
}
