import { VendorCreditDetailScreen } from "@/features/procurement/vendor-credits/screens/VendorCreditScreens";

export const metadata = { title: "Vendor credit" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VendorCreditDetailScreen creditId={id} />;
}
