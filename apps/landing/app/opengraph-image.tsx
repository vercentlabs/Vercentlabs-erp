import { ImageResponse } from "next/og";
import { LAUNCH_BUSINESS_MODULE_COUNT, POSITIONING, SITE_IDENTITY } from "@vercentlabs/landing-content";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The site-wide social card carries only the master brand message and minimal,
// register-derived proof — no screenshots, no capability count.
export default async function OpengraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", backgroundColor: "#f5f3ee", padding: "58px 64px", fontFamily: "sans-serif", color: "#17191d" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "2px solid #17191d", paddingTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}><div style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#4338ca", color: "white", fontSize: 19, fontWeight: 700 }}>V</div><div style={{ fontSize: 24, fontWeight: 650 }}>{SITE_IDENTITY.productName}</div></div>
        <div style={{ fontSize: 14, letterSpacing: 2.3, color: "#69707a" }}>{SITE_IDENTITY.category.toUpperCase()}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", width: 960 }}>
        <div style={{ fontSize: 84, fontWeight: 680, lineHeight: 0.98, letterSpacing: -4 }}>{POSITIONING.heroHeadline}</div>
        <div style={{ marginTop: 26, fontSize: 26, lineHeight: 1.4, color: "#5e6570" }}>{`${LAUNCH_BUSINESS_MODULE_COUNT} connected business modules on one shared platform.`}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #17191d", paddingBottom: 14, fontSize: 13, letterSpacing: 1.5, color: "#6b7280" }}><span>{SITE_IDENTITY.name.toUpperCase()}</span><span>vercentlabs.com</span></div>
    </div>,
    { ...size },
  );
}
