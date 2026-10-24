import { GateReceiveScreen } from "@/features/procurement/gate/GateScreens";

export const metadata = { title: "Receive at the gate" };

export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <GateReceiveScreen orderId={orderId} />;
}
