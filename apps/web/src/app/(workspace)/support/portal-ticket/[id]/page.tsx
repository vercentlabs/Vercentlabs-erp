import { PortalTicketDetailScreen } from "@/features/support/screens/PortalScreens";

export const metadata = { title: "My ticket" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PortalTicketDetailScreen id={id} />;
}
