import { ReservationDetailScreen } from "@/features/reservations/screens/ReservationDetailScreen";

export const metadata = { title: "Reservation" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReservationDetailScreen reservationId={id} />;
}
