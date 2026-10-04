import { ProductDetailScreen } from "@/features/sales/products/screens/ProductDetailScreen";

export const metadata = { title: "Product" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetailScreen key={id} productId={id} />;
}
