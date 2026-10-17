import type { MetadataRoute } from "next";
import { SITE_IDENTITY } from "@vercentlabs/landing-content";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_IDENTITY.productName,
    short_name: SITE_IDENTITY.name,
    description: SITE_IDENTITY.category,
    start_url: "/",
    display: "standalone",
    background_color: "#f9fafb",
    theme_color: "#f9fafb",
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
