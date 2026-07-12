import ProductMarketingSections from "@/components/home/product-marketing-sections";
import HeroSection from "@/components/home/hero-section";
import AnnouncementBar from "@/components/layout/announcement-bar";
import MobileContactCta from "@/components/marketing/mobile-contact-cta";
import SiteFooter from "@/components/marketing/site-footer";

export default function HomePage() {
  return (
    <>
      <AnnouncementBar />

      <main id="main-content">
        <HeroSection />
        <ProductMarketingSections />
      </main>

      <SiteFooter />
      <MobileContactCta />
    </>
  );
}
