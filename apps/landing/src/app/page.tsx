import HeroSection from "@/components/home/hero-section";
import ProductMarketingSections from "@/components/home/product-marketing-sections";
import AnnouncementBar from "@/components/layout/announcement-bar";
import MobileContactCta from "@/components/marketing/mobile-contact-cta";
import SiteFooter from "@/components/marketing/site-footer";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-slate-950">
      <AnnouncementBar />
      <main id="main-content">
        <HeroSection />
        <ProductMarketingSections />
      </main>

      <SiteFooter />
      <MobileContactCta />
    </div>
  );
}
