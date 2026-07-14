import HeroSection from "@/components/home/hero-section";
import ProductMarketingSections from "@/components/home/product-marketing-sections";
import AnnouncementBar from "@/components/layout/announcement-bar";
import MobileContactCta from "@/components/marketing/mobile-contact-cta";
import SiteFooter from "@/components/marketing/site-footer";
import OrganizationJsonLd from "@/components/seo/organization-json-ld";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white pb-16 text-slate-950 sm:pb-20 md:pb-0">
      <OrganizationJsonLd />
      <AnnouncementBar />

      <main id="main-content" className="marketing-main">
        <HeroSection />
        <ProductMarketingSections />
      </main>

      <SiteFooter />
      <MobileContactCta />
    </div>
  );
}
