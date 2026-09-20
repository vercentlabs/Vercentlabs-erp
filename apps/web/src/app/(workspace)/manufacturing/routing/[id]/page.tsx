import { RoutingCreateScreen, RoutingDetailScreen } from "@/features/manufacturing/screens/RoutingScreens";

export const metadata = { title: "Routing" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return id === "new" ? <RoutingCreateScreen /> : <RoutingDetailScreen id={id} />;
}
