import { ProductFormScreen } from "@/features/sales/products/screens/ProductFormScreen";

export const metadata = { title: "Edit product" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductFormScreen key={id} productId={id} />;
}
