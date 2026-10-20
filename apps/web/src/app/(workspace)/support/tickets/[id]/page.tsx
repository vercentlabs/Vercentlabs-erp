import { TicketDetailScreen } from "@/features/support/desk/DeskScreens";

export const metadata = { title: "Ticket" };

export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketDetailScreen id={id} />;
}
