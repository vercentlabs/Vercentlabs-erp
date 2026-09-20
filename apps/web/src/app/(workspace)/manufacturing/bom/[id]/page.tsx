import { BomCreateScreen, BomDetailScreen } from "@/features/manufacturing/screens/BomDetailScreen";

export const metadata = { title: "BOM" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return id === "new" ? <BomCreateScreen /> : <BomDetailScreen id={id} />;
}
