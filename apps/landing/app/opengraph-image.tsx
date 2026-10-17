import { ImageResponse } from "next/og";
import { POSITIONING, SITE_IDENTITY } from "@vercentlabs/landing-content";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", backgroundColor: "#f5f3ee", padding: "58px 64px", fontFamily: "sans-serif", color: "#17191d" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "2px solid #17191d", paddingTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}><div style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#4338ca", color: "white", fontSize: 19, fontWeight: 700 }}>V</div><div style={{ fontSize: 24, fontWeight: 650 }}>{SITE_IDENTITY.name}</div></div>
        <div style={{ fontSize: 14, letterSpacing: 2.3, color: "#69707a" }}>OPERATIONS / ERP / SYSTEM</div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 48 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 820 }}><div style={{ fontSize: 72, fontWeight: 680, lineHeight: 0.98, letterSpacing: -3.7 }}>{POSITIONING.heroHeadline}</div><div style={{ marginTop: 24, width: 650, fontSize: 22, lineHeight: 1.45, color: "#5e6570" }}>{SITE_IDENTITY.category}</div></div>
        <div style={{ width: 190, borderTop: "1px solid #a5a8ad", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}><div style={{ fontSize: 12, letterSpacing: 1.7, color: "#6b7280" }}>OPERATING INDEX</div>{["CONNECTED", "GOVERNED", "TRACEABLE"].map((label, index) => <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #d5d2ca", paddingBottom: 7, fontSize: 13 }}><span>{label}</span><span style={{ color: "#4338ca" }}>0{index + 1}</span></div>)}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #17191d", paddingBottom: 14, fontSize: 13, letterSpacing: 1.5, color: "#6b7280" }}><span>VERCENTLABS / OPERATIONAL LEDGER</span><span>vercentlabs.com</span></div>
    </div>,
    { ...size },
  );
}
