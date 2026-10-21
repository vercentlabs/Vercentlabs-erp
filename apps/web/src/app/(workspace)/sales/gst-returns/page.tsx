import { GstReturnsScreen } from "@/features/accounting/gst/GstScreens";

export const metadata = { title: "GST Returns" };

// Sales › Bill & collect › GST Returns: GSTR-1 from the company's sales, for a company with Sales alone too (Sales audit M8).
export default function Page() {
  return <GstReturnsScreen />;
}
