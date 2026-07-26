import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vercentlabs ERP",
    short_name: "Vercentlabs",
    description:
      "Governed CRM early access on the Vercentlabs ERP platform foundation.",
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
