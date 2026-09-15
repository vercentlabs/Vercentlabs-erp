import { ManageBookingScreen } from "@/features/crm/public-booking/screens/ManageBookingScreen";

export const metadata = { title: "Manage your meeting" };

export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center bg-canvas px-4 py-12">
      <ManageBookingScreen token={token} />
    </div>
  );
}
