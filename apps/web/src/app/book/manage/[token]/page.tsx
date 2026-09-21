import { ManageBookingScreen } from "@/features/crm/public-booking/screens/ManageBookingScreen";

export const metadata = { title: "Manage your meeting" };

export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="min-h-screen bg-canvas">
      <ManageBookingScreen token={token} />
    </div>
  );
}
