import HeroSection from "@/components/home/hero-section";
import AnnouncementBar from "@/components/layout/announcement-bar";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-(--text-primary)">
      <AnnouncementBar />

      <main id="main-content">
        <HeroSection />
      </main>
    </div>
  );
}
