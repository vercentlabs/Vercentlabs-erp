import { ImageResponse } from "next/og";
import { POSITIONING, SITE_IDENTITY, COLOR_TOKENS } from "@vercentlabs/landing-content";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Generated through code (Next.js's built-in next/og ImageResponse), not a
 * remote design service — per docs/landing-redesign/phase-1/
 * seo-aeo-geo-architecture.md's Open Graph requirement. Uses only real brand
 * colour/wordmark and the approved hero headline — no invented metrics, no
 * screenshot crammed into an unreadable size.
 */
export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#f9fafb",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              backgroundColor: "#4338ca",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: 32,
              fontWeight: 700,
            }}
          >
            V
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, color: "#101828" }}>{SITE_IDENTITY.name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
          <div style={{ fontSize: 60, fontWeight: 700, color: "#101828", lineHeight: 1.1, letterSpacing: -1 }}>
            {POSITIONING.heroHeadline}
          </div>
          <div style={{ fontSize: 28, color: COLOR_TOKENS.mutedInk, lineHeight: 1.4 }}>{SITE_IDENTITY.category}</div>
        </div>

        <div style={{ display: "flex", gap: 40 }}>
          {["12 connected modules", "1,039 implemented capabilities", "Role-based access"].map((label) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: "#4338ca" }} />
              <div style={{ fontSize: 22, color: "#101828" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
