import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VercentLabs ERP",
    short_name: "VercentLabs",
    description:
      "Governed CRM early access on the VercentLabs ERP platform foundation.",
    start_url: "/",
    display: "standalone",
    background_color: "#f2efe7",
    theme_color: "#0c0f12",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
