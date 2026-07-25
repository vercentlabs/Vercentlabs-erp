import HeroSection from "@/components/home/hero-section";
import ProductMarketingSections from "@/components/home/product-marketing-sections";
import AnnouncementBar from "@/components/layout/announcement-bar";
import Header from "@/components/layout/header";
import MobileContactCta from "@/components/marketing/mobile-contact-cta";
import SiteFooter from "@/components/marketing/site-footer";
import OrganizationJsonLd from "@/components/seo/organization-json-ld";

export default function HomePage() {
  return (
    <div className="os-site-shell">
      <OrganizationJsonLd />
      <AnnouncementBar />
      <Header />

      <main id="main-content" tabIndex={-1} className="marketing-main">
        <HeroSection />
        <ProductMarketingSections />
      </main>

      <SiteFooter />
      <MobileContactCta />
    </div>
  );
}
