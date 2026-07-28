import { ImageResponse } from "next/og";

export const alt = "Vercentlabs ERP — Run the work. Keep the truth.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: "#f2efe7",
        color: "#0c0f12",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 34,
          height: "100%",
          display: "flex",
          background: "#4353ff",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 54,
          top: 54,
          width: 34,
          height: 34,
          display: "flex",
          background: "#d9ff43",
          border: "2px solid #0c0f12",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          padding: "64px 78px 56px 94px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            fontSize: 28,
            fontWeight: 900,
            letterSpacing: -1.8,
          }}
        >
          <span>VERCENTLABS</span>
          <span style={{ fontWeight: 500, marginLeft: 4 }}>LABS</span>
        </div>

        <div
          style={{
            display: "flex",
            maxWidth: 980,
            marginTop: 76,
            fontSize: 78,
            lineHeight: 0.98,
            letterSpacing: -5,
            fontWeight: 900,
          }}
        >
          Run the work. Keep the truth.
        </div>

        <div
          style={{
            display: "flex",
            maxWidth: 920,
            marginTop: 30,
            fontSize: 25,
            lineHeight: 1.4,
            color: "#353a3f",
          }}
        >
          Released CRM, Sales, Accounting and Procurement on a governed ERP foundation.
        </div>

        <div
          style={{
            display: "flex",
            marginTop: "auto",
            borderTop: "2px solid #0c0f12",
            paddingTop: 22,
            gap: 34,
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          <span>04 / modules released</span>
          <span>Platform controls implemented</span>
          <span>08 roadmap modules</span>
        </div>
      </div>
    </div>,
    size,
  );
}
