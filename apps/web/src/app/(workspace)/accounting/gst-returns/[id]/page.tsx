import { GstReturnScreen } from "@/features/accounting/gst/GstScreens";

export const metadata = { title: "GST Return" };

export default async function GstReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GstReturnScreen id={id} />;
}
