import { BookMeetingScreen } from "@/features/crm/public-booking/screens/BookMeetingScreen";

export const metadata = { title: "Book a meeting" };

export default async function PublicBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="min-h-screen bg-canvas">
      <BookMeetingScreen token={token} />
    </div>
  );
}
