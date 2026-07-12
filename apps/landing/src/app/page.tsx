import HeroSection from "@/components/home/hero-section";
import AnnouncementBar from "@/components/layout/announcement-bar";
import Header from "@/components/layout/header";

export default function HomePage() {
  return (
    <>
      <AnnouncementBar />
      <Header />

      <main id="main-content">
        <HeroSection />
      </main>
    </>
  );
}
