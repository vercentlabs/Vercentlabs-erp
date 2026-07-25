import Link from "next/link";

export default function MobileContactCta() {
  return (
    <div className="os-mobile-cta">
      <Link href="/product">Released scope</Link>
      <Link href="/contact">Book a demo ↗</Link>
    </div>
  );
}
