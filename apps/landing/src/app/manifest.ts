import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VercentLabs ERP",
    short_name: "VercentLabs ERP",
    description: "Connected enterprise operations by VercentLabs.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4f46e5",
    icons: [
      {
        src: "/brand/logo.png",
        sizes: "any",
        type: "image/png",
      },
    ],
  };
}
