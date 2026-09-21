import { PortalArticleScreen } from "@/features/support/screens/PortalScreens";

export const metadata = { title: "Help article" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PortalArticleScreen id={id} />;
}
