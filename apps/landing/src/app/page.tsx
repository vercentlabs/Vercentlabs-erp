import HeroSection from "@/components/home/hero-section";
import ProductMarketingSections from "@/components/home/product-marketing-sections";
import MarketingShell from "@/components/marketing/marketing-shell";

export default function HomePage() {
  return (
    <MarketingShell>
      <HeroSection />
      <ProductMarketingSections />
    </MarketingShell>
  );
}
