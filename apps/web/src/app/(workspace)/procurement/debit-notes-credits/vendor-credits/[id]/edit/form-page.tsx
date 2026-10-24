import { VendorCreditFormScreen } from "@/features/procurement/vendor-credits/screens/VendorCreditScreens";

export const metadata = { title: "Edit supplier credit note" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VendorCreditFormScreen creditId={id} />;
}
