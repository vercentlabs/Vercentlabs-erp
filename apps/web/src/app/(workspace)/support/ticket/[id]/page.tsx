import { TicketDetailScreen } from "@/features/support/screens/TicketScreens";

export const metadata = { title: "Ticket" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketDetailScreen id={id} />;
}
