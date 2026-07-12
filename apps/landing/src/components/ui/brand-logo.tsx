import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  inverted?: boolean;
};

export default function BrandLogo({ inverted = false }: BrandLogoProps) {
  return (
    <Link
      href="/"
      aria-label="VercentLabs homepage"
      className="inline-flex items-center gap-2.5"
    >
      <Image
        src="/brand/logo.png"
        alt=""
        width={36}
        height={36}
        priority
        className="h-9 w-9 object-contain"
      />

      <span
        className={`font-display text-lg font-extrabold tracking-[-0.03em] ${
          inverted ? "text-white" : "text-slate-950"
        }`}
      >
        VercentLabs
      </span>
    </Link>
  );
}
