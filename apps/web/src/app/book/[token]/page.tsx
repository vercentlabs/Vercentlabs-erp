import { BookMeetingScreen } from "@/features/crm/public-booking/screens/BookMeetingScreen";

export const metadata = { title: "Book a meeting" };

export default async function PublicBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center bg-canvas px-4 py-12">
      <BookMeetingScreen token={token} />
    </div>
  );
}
